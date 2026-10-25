/* Optional HTTP connector. Backend supplies the actual URLs and response rendering. */
(() => {
  'use strict';
  const connections = new Map();

  function connectForm(name, { url, method = 'POST', encoding = 'json', csrfToken, onSuccess } = {}) {
    const form = [...document.querySelectorAll('form[data-form]')].find(item => item.dataset.form === name);
    if (!form) throw new Error(`Unknown form: ${name}`);
    function resolveEndpoint() {
      const value = typeof url === 'function' ? url(form) : url;
      const endpoint = new URL(value, location.href);
      if (!value || endpoint.origin !== location.origin || !['http:', 'https:'].includes(endpoint.protocol)) {
        throw new Error('A same-origin HTTP(S) endpoint is required.');
      }
      return endpoint;
    }
    if (typeof url !== 'function') resolveEndpoint();
    method = method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Use a body-bearing HTTP method.');
    if (!['json', 'form-data'].includes(encoding)) throw new Error('Unknown form encoding.');
    if (form.querySelector('input[type="file"]') && encoding !== 'form-data') {
      throw new Error('File uploads require form-data encoding.');
    }
    connections.get(name)?.();
    const submit = form.querySelector('[type="submit"]');
    const submitWasDisabled = submit.disabled;
    const status = document.createElement('p');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    form.append(status);
    const hint = form.querySelector('[data-connection-hint]') ||
      [...form.querySelectorAll('.hint')].find(item => /подключени|подключение|статичная форма|демо/i.test(item.textContent));
    const hintWasHidden = hint?.hidden;
    if (hint) hint.hidden = true;
    form.removeAttribute('data-ui-only');
    submit.disabled = false;
    let busy = false;
    let connected = true;
    let controller;

    async function send(event) {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      const fields = new FormData(form);
      fields.delete('password_confirm');
      fields.delete('spot_code'); // Display label; server needs the selected place ID.
      if (form.dataset.bikeId) fields.set('bike_id', form.dataset.bikeId);
      busy = true;
      submit.disabled = true;
      form.setAttribute('aria-busy', 'true');
      status.textContent = 'Отправка…';
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const headers = { Accept: 'application/json' };
        if (csrfToken) headers['X-CSRFToken'] = csrfToken;
        if (encoding === 'json') headers['Content-Type'] = 'application/json';
        const response = await fetch(resolveEndpoint(), {
          method, headers, credentials: 'same-origin', signal: controller.signal,
          body: encoding === 'json' ? JSON.stringify(Object.fromEntries(fields)) : fields,
        });
        const data = response.status === 204 ? null : await response.json();
        if (!connected) return;
        if (!response.ok) {
          const message = typeof data?.detail === 'string' ? data.detail :
            typeof data?.message === 'string' ? data.message :
            Array.isArray(data?.detail) ? data.detail.map(item => item.msg).join('; ') : `Ошибка сервера (${response.status}).`;
          status.textContent = message;
          return;
        }
        status.textContent = 'Запрос выполнен сервером.';
        for (const input of form.querySelectorAll('[data-secret]')) input.value = '';
        // No success state, profile or permissions are invented on the client.
        if (onSuccess) await onSuccess(data, form);
        form.dispatchEvent(new CustomEvent('veloregistry:success', { bubbles: true, detail: { name, data } }));
      } catch (error) {
        if (!connected) return;
        status.textContent = error.name === 'AbortError' ?
          'Сервер не ответил вовремя. Проверьте состояние перед повторной отправкой.' :
          'Не удалось обработать ответ сервера. Проверьте подключение и состояние операции.';
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (connected) {
          submit.disabled = false;
          form.removeAttribute('aria-busy');
        }
      }
    }
    form.addEventListener('submit', send);
    const disconnect = () => {
      connected = false;
      controller?.abort();
      form.removeEventListener('submit', send);
      form.setAttribute('data-ui-only', '');
      submit.disabled = submitWasDisabled;
      form.removeAttribute('aria-busy');
      if (hint) hint.hidden = hintWasHidden;
      status.remove();
      connections.delete(name);
    };
    connections.set(name, disconnect);
    return disconnect;
  }

  // The map teammate passes the selected server ID to an existing form.
  function setSelectedSpot(name, { id, label }) {
    if (!['bike-register', 'request-create'].includes(name) || !id || !label) {
      throw new Error('Provide a registration/request form, spot ID and display label.');
    }
    const form = [...document.querySelectorAll('[data-form]')].find(item => item.dataset.form === name);
    form.elements.namedItem('target_spot_id').value = id;
    const display = form.querySelector('[data-selected-place]');
    if (display) display.textContent = label;
    else form.elements.namedItem('spot_code').value = label;
  }

  window.Veloregistry = Object.freeze({ connectForm, setSelectedSpot });
})();
