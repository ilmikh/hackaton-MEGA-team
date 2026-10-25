const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_URL || 'http://127.0.0.1:3013';

(async () => {
  let server;
  if (!process.env.UI_URL) {
    server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], {
      env: { ...process.env, PORT: '3013' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.on('exit', () => server.kill());
    await new Promise((resolve, reject) => {
      server.stdout.once('data', resolve);
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Static preview exited: ${code}`)));
    });
  }
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  let requests = 0;
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType())) requests++;
  });
  const route = async hash => {
    await page.evaluate(value => { location.hash = value; }, hash);
    await page.waitForFunction(value => location.hash === value, hash);
    await page.waitForTimeout(40);
  };
  try {
    await page.goto(base);
    await page.waitForSelector('.js-ready');
    assert.equal(await page.locator('.view:visible').count(), 1);
    const ids = await page.locator('[id]').evaluateAll(items => items.map(item => item.id));
    assert.equal(ids.length, new Set(ids).size, 'duplicate ids');
    const missing = await page.locator('a[href^="#"]').evaluateAll(links => links
      .map(link => link.getAttribute('href').slice(1).split('?')[0])
      .filter(id => !document.getElementById(id)));
    assert.deepEqual(missing, []);
    await route('#page-admin-map');
    assert.equal(await page.locator('[data-admin-bike]:visible').count(), 3);
    await page.locator('#admin-bike-search').fill('Forward');
    assert.equal(await page.locator('[data-admin-bike]:visible').count(), 1);
    await page.locator('[data-admin-bike]:visible').click();
    await page.waitForURL('**/#page-admin-bike-008');
    await route('#page-admin-map');
    await page.locator('#admin-bike-search').fill('нет такого велосипеда');
    assert.ok(await page.locator('#admin-bike-empty').isVisible());
    await page.locator('#admin-bike-search').fill('');
    await route('#page-admin-requests');
    await page.locator('#admin-request-filter').selectOption('pending');
    assert.equal(await page.locator('[data-admin-request]:visible').count(), 1);
    await page.locator('[data-admin-request]:visible summary').click();
    await page.locator('[data-admin-request]:visible [data-decision="rejected"]').click();
    assert.equal(await page.locator('[data-admin-request]:visible').getAttribute('data-status'), 'pending');
    await page.locator('[data-admin-request]:visible textarea').fill('Место занято');
    await page.locator('[data-admin-request]:visible [data-decision="rejected"]').click();
    assert.ok(await page.locator('#admin-request-empty').isVisible());
    await page.locator('#admin-request-filter').selectOption('rejected');
    assert.equal(await page.locator('[data-admin-request]:visible').count(), 2);
    await page.reload();
    assert.equal(await page.locator('[data-admin-request][data-status="pending"]').count(), 1);

    // Every screen/deep link, including dialogs, has exactly one visible owner page.
    const routes = await page.locator('.view, .modal-target').evaluateAll(items => items.map(item => item.id));
    for (const id of routes) {
      await route(`#${id}`);
      assert.equal(await page.locator('.view:visible').count(), 1, id);
      assert.ok(await page.locator(`#${id}`).isVisible(), id);
    }
    await route('#page-bike-forward');
    await page.getByRole('link', { name: 'Изменить описание', exact: true }).click();
    await page.waitForURL('**/#page-edit-bike?bike=b2');
    assert.equal(await page.locator('[data-edit-form]:visible [name="model"]').inputValue(), 'Forward');
    assert.equal(await page.locator('[data-return-to-bike]:visible').getAttribute('href'), '#page-bike-forward');
    await page.reload();
    assert.equal(await page.locator('[data-edit-form]:visible [name="model"]').inputValue(), 'Forward');
    await page.getByRole('link', { name: 'Назад к велосипеду', exact: true }).click();
    await page.getByRole('link', { name: 'Добавить заявку', exact: true }).click();
    await page.locator('#requests-new[open]').waitFor();
    assert.equal(await page.locator('#request-bike').inputValue(), 'b2');
    await page.locator('[name="request_type"]').selectOption('release');
    assert.ok(await page.locator('[name="spot_code"]').isHidden());
    await page.locator('[name="request_type"]').selectOption('move');
    assert.ok(await page.locator('[name="spot_code"]').isVisible());
    await page.keyboard.press('Escape');
    await page.waitForURL('**/#page-requests');
    for (const [filter, count] of [['pending', 1], ['done', 2], ['all', 3]]) {
      await page.locator(`label[for="requests-${filter}"]`).click();
      assert.equal(await page.locator('.request-table tbody tr:visible').count(), count);
    }
    await route('#page-bike');
    const qrTrigger = page.getByRole('link', { name: 'Мой QR', exact: true });
    await qrTrigger.click();
    await page.keyboard.press('Escape');
    await page.waitForURL('**/#page-bike');
    assert.ok(await qrTrigger.evaluate(item => item === document.activeElement), 'focus restored');
    await page.goBack();
    await page.locator('#bike-my-qr[open]').waitFor();
    await page.goForward();
    await page.waitForURL('**/#page-bike');

    await route('#account-login');
    await page.locator('#login-password').fill('ui-test-password');
    await page.locator('[data-toggle-password="login-password"]').click();
    assert.equal(await page.locator('#login-password').getAttribute('type'), 'text');
    await page.locator('#account-login').getByRole('link', { name: 'Зарегистрироваться', exact: true }).click();
    await page.locator('#account-register[open]').waitFor();
    await page.waitForFunction(() => document.querySelector('#login-password').value === '');
    await page.locator('#register-last-name').fill('Иванов');
    await page.locator('#register-first-name').fill('Иван');
    await page.locator('#register-username').fill('@demo_user');
    await page.locator('#register-password').fill('ui-test-password');
    await page.locator('#account-register [type="submit"]').click();
    await page.waitForURL('**/#page-profile');
    assert.equal(await page.locator('#page-profile [name="display_name"]').inputValue(), 'Иванов Иван');
    assert.equal(await page.locator('#page-profile [name="telegram"]').inputValue(), '@demo_user');
    await page.waitForFunction(() => document.querySelector('#register-password').value === '');
    await page.getByRole('link', { name: 'Изменить логин и пароль', exact: true }).click();
    await page.locator('#account-settings[open]').waitFor();
    await page.locator('#account-settings-new').fill('ui-test-password');
    await page.locator('#account-settings-confirm').fill('another-password');
    assert.equal(await page.locator('#account-settings-confirm').evaluate(input => input.checkValidity()), false);
    await page.locator('#account-settings-confirm').fill('ui-test-password');
    assert.equal(await page.locator('#account-settings-confirm').evaluate(input => input.checkValidity()), true);
    await page.keyboard.press('Escape');
    await route('#page-profile');
    await page.locator('#page-profile [name="phone"]').fill('+7 999 123-45-67');
    await page.locator('#page-profile [name="telegram"]').fill('without_at');
    assert.equal(await page.locator('#page-profile [name="telegram"]').evaluate(input => input.checkValidity()), false);
    await page.locator('#page-profile [name="telegram"]').fill('@demo_user');
    assert.equal(await page.locator('#page-profile [name="telegram"]').evaluate(input => input.checkValidity()), true);
    assert.equal(await page.locator('.admin-nav a[href="#page-admin-profile"]').count(), 0);

    await route('#page-register');
    await page.locator('[name="model"]:visible').fill('Unsaved draft');
    await page.getByRole('link', { name: 'Выбрать свободное место на карте', exact: true }).click();
    await page.goBack();
    assert.equal(await page.locator('[name="model"]:visible').inputValue(), 'Unsaved draft');
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 10, height: 10 } });
    await page.locator('[name="photo"]').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: png });
    await page.locator('.file-preview:visible').waitFor();
    await page.waitForFunction(() => document.querySelector('#page-register .file-preview').naturalWidth > 0);
    assert.ok(await page.locator('#page-register .file-preview').evaluate(image => image.complete && image.naturalWidth > 0));
    await page.locator('[name="photo"]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    assert.ok(await page.locator('#page-register .file-preview').isHidden());
    assert.equal(await page.locator('[name="photo"]').evaluate(input => input.files.length), 0);
    assert.equal(requests, 0, 'unconfigured UI sends no requests');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);

    // Test only the CLIENT adapter, with intercepted responses; no backend is created.
    let body;
    await page.route('**/ui-test-login', async request => {
      body = request.request().postDataJSON();
      await request.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'Проверочный ответ сервера' }) });
    });
    await page.evaluate(() => { window.disconnectLogin = Veloregistry.connectForm('account-login', { url: '/ui-test-login' }); });
    await route('#account-login');
    await page.locator('#login-username').fill('ui-test-user');
    await page.locator('#login-password').fill('ui-test-password');
    await page.locator('#account-login [type="submit"]').click();
    await page.getByRole('status').filter({ hasText: 'Проверочный ответ сервера' }).waitFor();
    assert.deepEqual(body, { username: 'ui-test-user', password: 'ui-test-password' });
    await page.unroute('**/ui-test-login');
    await page.route('**/ui-test-login', request => request.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.locator('#account-login [type="submit"]').click();
    await page.getByRole('status').filter({ hasText: 'Запрос выполнен сервером.' }).waitFor();
    await page.waitForFunction(() => document.querySelector('#login-password').value === '');
    await page.evaluate(() => window.disconnectLogin());
    assert.ok(await page.locator('#account-login [type="submit"]').isEnabled());
    await page.locator('#login-password').fill('ui-test-password');
    await page.locator('#account-login [type="submit"]').click();
    await page.waitForURL('**/#page-profile');
    await route('#account-login');
    await page.keyboard.press('Escape');

    fs.mkdirSync('test-results', { recursive: true });
    await route('#account-login');
    await page.screenshot({ path: 'test-results/ui-login-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of ['account-login', 'account-register', 'account-settings', 'page-requests', 'page-bikes']) {
      await route(`#${id}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mobile width: ${id}`);
    }
    await route('#account-register');
    await page.screenshot({ path: 'test-results/ui-register-mobile.png', fullPage: true });
    await page.evaluate(() => { location.hash = '#bad-fragment'; });
    await page.waitForURL('**/#page-profile');

    const offline = await browser.newPage();
    offline.on('pageerror', error => errors.push(error.message));
    await offline.goto(pathToFileURL(path.resolve('frontend/index.html')).href + '#account-login');
    await offline.locator('#account-login[open]').waitFor();
    await offline.close();
    const noJs = await browser.newPage({ javaScriptEnabled: false });
    await noJs.goto(base + '/#page-bikes');
    assert.ok(await noJs.locator('#page-bikes').isVisible());
    await noJs.close();
    assert.deepEqual(errors, []);
    console.log('PASS: screens and dialogs, history/focus/Escape/backdrop, bicycle context, filters, auth forms, local previews, drafts, mobile, file://, CSS fallback. No requests before configuration. JSON adapter checked with intercepted responses only.');
  } finally {
    await browser.close();
    server?.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
