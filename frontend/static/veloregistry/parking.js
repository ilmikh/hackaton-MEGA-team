/* Demonstration places positioned from the supplied plan. No reservation API. */
(() => {
  'use strict';
  const locations = [
    [60, 9, '8-1'], [30, 26, '8-1'], [45, 26, '8-1'], [30, 44, '8-1'], [30, 72, '8-1'],
    [76, 22, '9-4'], [76, 40, '9-4'], [76, 57, '9-4'], [65, 75, '9-4'], [47, 90, '9-4'],
  ].map(([x, y, building], index) => ({
    id: `p${index + 1}`, x, y, building, name: `Парковка ${index + 1} · ${building}`,
    total: building === '8-1' ? 10 : 12, occupied: 10,
  }));
  for (const page of document.querySelectorAll('#page-map, #page-admin-parking-map')) {
    const admin = page.classList.contains('admin-view');
    const canvas = page.querySelector('[data-map-canvas]');
    const info = page.querySelector('[data-parking-info]');
    let selected;
    function context() {
      return new URLSearchParams(location.hash.split('?')[1] || '');
    }
    function selectParking(parking) {
      selected = parking;
      for (const marker of page.querySelectorAll('[data-parking-id]')) {
        marker.setAttribute('aria-pressed', String(marker.dataset.parkingId === parking.id));
      }
      info.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = parking.name;
      const summary = document.createElement('p');
      summary.textContent = parking.total === parking.occupied ? 'Нет свободных мест' :
        admin ? `Занято ${parking.occupied} из ${parking.total}. Свободно: ${parking.total - parking.occupied}` : 'Есть свободные места';
      info.append(heading, summary);
      for (let number = admin ? 1 : parking.occupied + 1; number <= parking.total; number++) {
        const code = `${parking.building} / П${parking.id.slice(1)}-${String(number).padStart(2, '0')}`;
        const row = document.createElement('div');
        row.className = 'spot-row';
        const text = document.createElement('span');
        text.textContent = `${code} · ${number <= parking.occupied ? 'Занято' : 'Свободно'}`;
        row.append(text);
        if (!admin && number > parking.occupied) {
          const choose = document.createElement('button');
          choose.type = 'button'; choose.className = 'primary'; choose.textContent = 'Выбрать';
          choose.addEventListener('click', () => {
            const query = context();
            const registration = query.get('from') === 'page-register';
            Veloregistry.setSelectedSpot(registration ? 'bike-register' : 'request-create', {
              id: `${parking.id}-s${number}`, label: code,
            });
            const bike = query.get('bike');
            location.hash = registration ? '#page-register' : `#requests-new${bike ? `?bike=${encodeURIComponent(bike)}` : ''}`;
          });
          row.append(choose);
        }
        info.append(row);
      }
      const note = document.createElement('p'); note.className = 'hint';
      note.textContent = 'Демонстрационные места. Выбор не закрепляет место; сохранение требует сервера.';
      info.append(note);
    }
    for (const parking of locations) {
      const free = parking.total > parking.occupied;
      for (const [parent, isMap] of [[page.querySelector('[data-map-markers]'), true], [page.querySelector('[data-parking-list]'), false]]) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.parkingId = parking.id; button.setAttribute('aria-pressed', 'false');
        button.className = isMap ? `parking-marker ${free ? 'has-free' : 'is-full'}` : 'parking-list-button';
        button.textContent = isMap ? `${parking.building}\nП${parking.id.slice(1)}\n${admin ? `${parking.occupied}/${parking.total}` : free ? 'Есть места' : 'Занято'}` : `${parking.name} — ${free ? 'есть места' : 'занято'}`;
        button.setAttribute('aria-label', `${parking.name}: ${free ? 'есть свободные места' : 'мест нет'}`);
        if (isMap) { button.style.left = `${parking.x}%`; button.style.top = `${parking.y}%`; }
        button.addEventListener('click', () => selectParking(parking));
        parent.append(button);
      }
    }
    for (const toggle of page.querySelectorAll('[data-map-mode]')) toggle.addEventListener('click', () => {
      canvas.classList.toggle('satellite', toggle.dataset.mapMode === 'satellite');
      for (const other of page.querySelectorAll('[data-map-mode]')) other.setAttribute('aria-pressed', String(other === toggle));
    });
    function restoreSelection() {
      const id = context().get('parking');
      const parking = locations.find(item => item.id === id);
      if (parking) selectParking(parking);
      else if (selected) selectParking(selected);
    }
    document.addEventListener('veloregistry:route', event => { if (event.detail.page === page.id) restoreSelection(); });
    restoreSelection();
  }
})();
