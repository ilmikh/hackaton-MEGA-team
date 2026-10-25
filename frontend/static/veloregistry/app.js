/* UI wiring only. Session, permissions, data and submissions belong to the backend. */
(() => {
  'use strict';

  const pages = [...document.querySelectorAll('.view')];
  const dialogs = [...document.querySelectorAll('.modal-target')];
  let activePage;
  let activeDialog;
  let dialogTrigger;
  let editContext;

  function readRoute() {
    const [fragment, query = ''] = location.hash.slice(1).split('?');
    let target;
    try { target = document.getElementById(decodeURIComponent(fragment)); } catch { /* Invalid hash. */ }
    if (!fragment) {
      history.replaceState(null, '', `${location.pathname}${location.search}#account-login`);
      target = document.getElementById('account-login');
    }
    const page = target?.closest('.view');
    if (!page) {
      history.replaceState(null, '', `${location.pathname}${location.search}#page-profile`);
      return { target: pages[0], page: pages[0], params: new URLSearchParams() };
    }
    return { target, page, params: new URLSearchParams(query) };
  }

  function fillBikeEditor(page, params) {
    const form = page.querySelector('[data-edit-form]');
    if (!form) return;
    const bikeId = params.get('bike') || 'b1';
    const source = pages.find(item => item.dataset.bikeId === bikeId &&
      item.classList.contains('admin-view') === page.classList.contains('admin-view'));
    // Unknown IDs must never silently open a different bicycle.
    if (!source) {
      location.replace(`#${page.classList.contains('admin-view') ? 'page-admin-map' : 'page-bikes'}`);
      return;
    }
    const context = `${page.id}:${bikeId}`;
    if (editContext !== context) {
      for (const field of source.querySelectorAll('[data-bike-field]')) {
        const input = form.elements.namedItem(field.dataset.bikeField);
        input.value = field.dataset.empty === 'true' ? '' : field.textContent.trim();
      }
      editContext = context;
    }
    form.dataset.bikeId = bikeId;
    form.querySelector('[data-return-to-bike]').href = `#${source.id}`;
  }

  function renderRoute() {
    const { target, page, params } = readRoute();
    const dialog = target.matches('.modal-target') ? target : null;
    const previousPage = activePage;
    const previousDialog = activeDialog;
    if (previousDialog && previousDialog !== dialog) previousDialog.close();
    for (const item of pages) item.hidden = item !== page;
    const admin = page.classList.contains('admin-view');
    document.body.dataset.interface = admin ? 'admin' : 'resident';
    document.querySelector('.brand').href = admin ? '#page-admin-map' : '#page-profile';
    for (const link of document.querySelectorAll('nav a')) {
      const current = link.hash === `#${page.dataset.nav || page.id}`;
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    fillBikeEditor(page, params);
    const returnLink = page.querySelector('[data-return-to-form]');
    if (returnLink) {
      const from = params.get('from');
      returnLink.hidden = !['page-register', 'requests-new'].includes(from);
      returnLink.href = from === 'requests-new' ?
        `#requests-new${params.get('bike') ? `?bike=${encodeURIComponent(params.get('bike'))}` : ''}` : '#page-register';
    }
    if (dialog?.id === 'requests-new') {
      const bike = params.get('bike');
      if (bike && [...document.querySelector('#request-bike').options].some(option => option.value === bike)) {
        document.querySelector('#request-bike').value = bike;
      }
    }
    activePage = page;
    activeDialog = dialog;
    document.body.classList.toggle('modal-open', Boolean(dialog));
    document.title = `${dialog?.querySelector('h2')?.textContent || page.querySelector('h1').textContent} — Велореестр`;
    if (dialog) {
      if (!dialog.open) dialog.showModal();
    } else if (previousDialog && previousPage === page && dialogTrigger?.isConnected &&
      !dialogTrigger.closest('[hidden], dialog:not([open])')) {
      dialogTrigger.focus({ preventScroll: true });
    } else if (previousPage !== page || previousDialog) {
      const heading = page.querySelector('h1');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function closeDialog(dialog) {
    const closeLink = dialog.querySelector('a[aria-label="Закрыть"]');
    location.hash = closeLink?.hash || `#${dialog.closest('.view').id}`;
  }

  for (const dialog of dialogs) {
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link && !link.closest('dialog')) dialogTrigger = link;
    if (link?.matches('[data-place-picker]')) {
      const from = link.closest('dialog')?.id || link.closest('.view').id;
      const query = new URLSearchParams({ from });
      if (from === 'requests-new' && document.querySelector('#request-bike').value) {
        query.set('bike', document.querySelector('#request-bike').value);
      }
      link.hash = `page-map?${query}`;
    }
    const toggle = event.target.closest('[data-toggle-password]');
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Скрыть пароль' : 'Показать пароль';
      toggle.setAttribute('aria-pressed', String(show));
    }
  });

  for (const form of document.querySelectorAll('form[data-ui-only]')) {
    // Backend integration removes data-ui-only and connects a real submit handler.
    form.addEventListener('submit', event => {
      if (!form.hasAttribute('data-ui-only')) return;
      event.preventDefault();
      if (form.dataset.demoAuth && form.reportValidity()) {
        // A requested UI walkthrough, not authentication. Never store a password.
        const fields = new FormData(form);
        const username = fields.get('username').trim();
        const firstName = String(fields.get('first_name') || '').trim();
        const lastName = String(fields.get('last_name') || '').trim();
        const profile = document.querySelector('[data-form="profile"]');
        const displayName = form.dataset.demoAuth === 'settings' ?
          profile.elements.namedItem('display_name').value || username :
          [lastName, firstName].filter(Boolean).join(' ') || username;
        profile.elements.namedItem('display_name').value = displayName;
        profile.elements.namedItem('telegram').value = username.startsWith('@') ? username : `@${username}`;
        document.querySelector('[data-account-label]').textContent = displayName;
        document.querySelector('[data-session-hint]').textContent = 'Демонстрационный режим. Данные временные и исчезнут после перезагрузки.';
        document.querySelector('#login-username').value = username;
        document.querySelector('#account-settings-username').value = username;
        location.hash = '#page-profile';
      }
    });
    for (const input of form.querySelectorAll('[name="first_name"], [name="last_name"], [name="username"]')) {
      input.addEventListener('input', () => {
        input.setCustomValidity(input.value.trim() ? '' : 'Заполните поле.');
      });
    }
    for (const input of form.querySelectorAll('input[type="password"]')) {
      // Clear secrets when leaving an authentication window; never persist them.
      input.autocapitalize = 'none';
      input.spellcheck = false;
    }
    const confirmation = form.elements.namedItem('password_confirm');
    if (confirmation) {
      const password = form.elements.namedItem('new_password') || form.elements.namedItem('password');
      const validate = () => {
        confirmation.required = Boolean(password.value);
        confirmation.setCustomValidity(confirmation.value !== password.value ? 'Пароли не совпадают.' : '');
      };
      password.addEventListener('input', validate);
      confirmation.addEventListener('input', validate);
    }
  }
  for (const dialog of dialogs) {
    dialog.addEventListener('close', () => {
      for (const input of dialog.querySelectorAll('[data-secret]')) {
        input.value = '';
        input.type = 'password';
        input.setCustomValidity('');
        if (input.name === 'password_confirm') input.required = dialog.id === 'account-register';
      }
      for (const button of dialog.querySelectorAll('[data-toggle-password]')) {
        button.textContent = 'Показать пароль';
        button.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function filterRequests() {
    const filter = document.querySelector('[name="request-filter"]:checked').value;
    for (const row of document.querySelectorAll('.request-table tr[data-status]')) {
      row.hidden = filter === 'pending' ? row.dataset.status !== 'pending' :
        filter === 'done' ? row.dataset.status === 'pending' : false;
    }
  }
  for (const input of document.querySelectorAll('[name="request-filter"]')) {
    input.addEventListener('change', filterRequests);
  }
  const requestType = document.querySelector('[name="request_type"]');
  function updateRequestFields() {
    for (const field of document.querySelectorAll('[data-request-place]')) {
      field.hidden = requestType.value === 'release';
    }
    for (const input of document.querySelectorAll('#requests-new [name="spot_code"], #requests-new [name="target_spot_id"]')) {
      input.disabled = requestType.value === 'release';
    }
  }
  requestType.addEventListener('change', updateRequestFields);


  for (const input of document.querySelectorAll('input[type="file"]')) {
    const container = input.closest('.upload, .scanner-panel');
    const preview = document.createElement('img');
    preview.className = 'file-preview';
    preview.alt = input.name === 'photo' ? 'Выбранное фото велосипеда' : 'Выбранное фото QR';
    preview.hidden = true;
    const status = document.createElement('p');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    container.append(preview, status);
    let previewUrl;
    function clearPreview() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      preview.hidden = true;
      preview.removeAttribute('src');
    }
    preview.addEventListener('error', () => {
      clearPreview();
      input.value = '';
      input.setCustomValidity('Не удалось прочитать изображение. Выберите другой файл.');
      status.textContent = input.validationMessage;
    });
    input.addEventListener('change', () => {
      clearPreview();
      input.setCustomValidity('');
      status.textContent = '';
      const file = input.files[0];
      if (!file) return;
      const bikePhoto = input.name === 'photo';
      const validType = bikePhoto ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) :
        file.type.startsWith('image/');
      if (!validType || (bikePhoto && file.size > 2 * 1024 * 1024)) {
        input.value = '';
        input.setCustomValidity(bikePhoto ? 'Выберите JPG, PNG или WebP до 2 МБ.' : 'Выберите изображение QR.');
        status.textContent = input.validationMessage;
        return;
      }
      // Camera and upload are alternative inputs for one scanner, not two selections.
      if (!bikePhoto) {
        for (const other of container.querySelectorAll('input[type="file"]')) {
          if (other !== input) {
            other.value = '';
            other.dispatchEvent(new Event('change'));
          }
        }
      }
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.hidden = false;
      status.textContent = `${file.name} — предпросмотр. Файл не отправлен${bikePhoto ? '.' : ', QR не распознан.'}`;
    });
    input.form?.addEventListener('reset', () => {
      clearPreview();
      input.setCustomValidity('');
      status.textContent = '';
    });
    window.addEventListener('pagehide', clearPreview);
  }

  const bikeSearch = document.querySelector('#admin-bike-search');
  function searchAdminBikes() {
    const query = bikeSearch.value.trim().toLocaleLowerCase('ru');
    const cards = [...document.querySelectorAll('[data-admin-bike]')];
    for (const card of cards) card.hidden = !card.textContent.toLocaleLowerCase('ru').includes(query);
    const count = cards.filter(card => !card.hidden).length;
    document.querySelector('#admin-bike-count').textContent = `Найдено: ${count} из ${cards.length}`;
    document.querySelector('#admin-bike-empty').hidden = count > 0;
  }
  bikeSearch.addEventListener('input', searchAdminBikes);
  const adminFilter = document.querySelector('#admin-request-filter');
  function filterAdminRequests() {
    const rows = [...document.querySelectorAll('[data-admin-request]')];
    for (const row of rows) row.hidden = adminFilter.value !== 'all' && row.dataset.status !== adminFilter.value;
    const count = rows.filter(row => !row.hidden).length;
    document.querySelector('#admin-request-count').textContent = `Заявок: ${count}`;
    document.querySelector('#admin-request-empty').hidden = count > 0;
  }
  adminFilter.addEventListener('change', filterAdminRequests);
  for (const button of document.querySelectorAll('[data-decision]')) {
    button.addEventListener('click', () => {
      const row = button.closest('[data-admin-request]');
      if (row.dataset.status !== 'pending') return;
      const comment = row.querySelector('[data-decision-comment]');
      comment.setCustomValidity(button.dataset.decision === 'rejected' && !comment.value.trim() ? 'Укажите причину отклонения.' : '');
      if (!comment.reportValidity()) return;
      row.dataset.status = button.dataset.decision;
      row.querySelector('[data-decision-status]').textContent = button.dataset.decision === 'approved' ? 'Одобрена' : 'Отклонена';
      row.querySelector('[data-decision-message]').textContent = 'Демонстрационное решение принято. На сервер не отправлено.';
      for (const action of row.querySelectorAll('[data-decision]')) action.disabled = true;
      comment.readOnly = true;
      filterAdminRequests();
      if (row.hidden) adminFilter.focus();
    });
  }
  searchAdminBikes();
  filterAdminRequests();
  document.documentElement.classList.add('js-ready');
  window.addEventListener('hashchange', renderRoute);
  // History/BFCache may restore the DOM with a different fragment.
  window.addEventListener('pageshow', renderRoute);
  filterRequests();
  updateRequestFields();
  renderRoute();
})();
