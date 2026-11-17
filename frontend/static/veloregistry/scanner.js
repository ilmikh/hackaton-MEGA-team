/* Capture and prepare a photograph. QR recognition belongs to the backend. */
(() => {
  'use strict';
  for (const form of document.querySelectorAll('[data-scanner]')) {
    const page = form.closest('.view');
    const video = form.querySelector('video');
    const status = form.querySelector('[data-camera-status]');
    const preview = form.querySelector('[data-scan-preview]');
    const start = form.querySelector('[data-camera-start]');
    const capture = form.querySelector('[data-camera-capture]');
    const stopButton = form.querySelector('[data-camera-stop]');
    const placeholder = form.querySelector('[data-camera-placeholder]');
    const photo = form.querySelector('[name="photo"]');
    photo.required = true;
    let stream;
    let generation = 0;
    let previewUrl;
    function clearPreview() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null; preview.hidden = true; preview.removeAttribute('src');
      for (const input of form.querySelectorAll('input[type="file"]')) input.value = '';
      photo.setCustomValidity('');
    }
    function stop() {
      generation++;
      stream?.getTracks().forEach(track => track.stop());
      stream = null; video.srcObject = null; video.hidden = true;
      placeholder.hidden = false; capture.disabled = true; start.disabled = false; stopButton.hidden = true;
    }
    function selectFile(file) {
      clearPreview();
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
        photo.setCustomValidity('Выберите JPG, PNG или WebP до 20 МБ.');
        status.textContent = photo.validationMessage; return;
      }
      const files = new DataTransfer(); files.items.add(file); photo.files = files.files;
      previewUrl = URL.createObjectURL(file); preview.src = previewUrl; preview.hidden = false;
      status.textContent = `${file.name} — фото готово к отправке на сервер для распознавания QR.`;
    }
    preview.addEventListener('error', () => {
      clearPreview(); photo.setCustomValidity('Не удалось прочитать изображение.');
      status.textContent = photo.validationMessage;
    });
    start.addEventListener('click', async () => {
      stop();
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        status.textContent = 'Камере нужен HTTPS или localhost. Можно загрузить фото QR.'; return;
      }
      const requestGeneration = generation;
      start.disabled = true; status.textContent = 'Разрешите доступ к камере в браузере…';
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (requestGeneration !== generation || page.hidden || document.hidden) {
          media.getTracks().forEach(track => track.stop()); return;
        }
        stream = media; video.srcObject = media; video.hidden = false; placeholder.hidden = true; stopButton.hidden = false;
        await video.play();
        if (requestGeneration !== generation) return;
        capture.disabled = false;
        status.textContent = 'Наведите камеру на QR и нажмите «Сделать фото QR».';
      } catch (error) {
        if (requestGeneration !== generation) return;
        stop();
        status.textContent = error.name === 'NotAllowedError' ? 'Доступ к камере запрещён. Разрешите его в браузере или загрузите фото.' :
          error.name === 'NotFoundError' ? 'Камера не найдена. Загрузите фото QR.' : 'Не удалось включить камеру. Закройте другие приложения с камерой и повторите.';
      }
    });
    stopButton.addEventListener('click', () => { stop(); status.textContent = 'Камера выключена.'; });
    capture.addEventListener('click', () => {
      if (!video.videoWidth || !video.videoHeight) { status.textContent = 'Камера ещё загружается. Повторите снимок.'; return; }
      const canvas = document.createElement('canvas');
      const ratio = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const requestGeneration = generation;
      canvas.toBlob(blob => {
        if (requestGeneration !== generation || page.hidden) return;
        if (!blob) { status.textContent = 'Не удалось сделать снимок. Повторите.'; return; }
        selectFile(new File([blob], 'qr-camera.jpg', { type: 'image/jpeg' }));
        stop();
      }, 'image/jpeg', 0.92);
    });
    form.querySelector('[data-camera-clear]').addEventListener('click', () => {
      stop(); clearPreview(); status.textContent = 'Снимок очищен. Можно сделать новый.';
    });
    for (const input of form.querySelectorAll('input[type="file"]')) input.addEventListener('change', () => {
      const file = input.files[0]; stop(); selectFile(file);
    });
    form.addEventListener('reset', () => { stop(); clearPreview(); });
    document.addEventListener('veloregistry:route', event => { if (event.detail.page !== page.id) stop(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    window.addEventListener('pagehide', () => { stop(); clearPreview(); });
  }
})();
