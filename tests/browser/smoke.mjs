// Run against the isolated local QA server described in docs/TESTING.md.
// Never run this against a real cloud database. Generation requests are intercepted.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import chromiumBinary from '@sparticuz/chromium';
import { PNG } from 'pngjs';
import { readFile, mkdir } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only an isolated local QA server is permitted');
const bootstrap = await (await fetch(`${base}/api/admin/bootstrap`)).json();
assert.equal(bootstrap.storage, 'file');
assert.equal(bootstrap.adminEmail, 'model-lab-smoke@example.test');
const artifacts = path.resolve('data/browser-smoke');
await mkdir(artifacts, { recursive: true });

// Npm-delivered Chromium is useful when the Playwright CDN is unavailable.
// Its small Lambda library bundle supplies libnss/libnspr on minimal CI hosts.
const runtime = path.join(artifacts, 'runtime');
await mkdir(runtime, { recursive: true });
const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
const archive = brotliDecompressSync(await readFile(path.join(packageRoot, 'bin/al2023.tar.br')));
execFileSync('tar', ['-xf', '-', '-C', runtime], { input: archive });
const args = chromiumBinary.args.filter(arg => !['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials', '--single-process'].includes(arg));
const browser = await chromium.launch({
  executablePath: process.env.TEST_BROWSER_EXECUTABLE || await chromiumBinary.executablePath(), args, headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(runtime, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` },
});
function image(width, height, rgb) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
}
const upload = image(32, 32, [180, 180, 180]);
const before = `data:image/png;base64,${image(400, 200, [230, 45, 45]).toString('base64')}`;
const after = `data:image/png;base64,${image(400, 400, [35, 80, 220]).toString('base64')}`;
const requests = [];
const history = [];
let release;
const gate = new Promise(resolve => { release = resolve; });
const pageErrors = [];
function field(buffer, name) {
  return buffer.toString('latin1').match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)`))?.[1];
}
async function wire(page) {
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/generations', route => route.fulfill({ json: { generations: history } }));
  await page.route('**/api/gallery', route => route.fulfill({ json: { items: [{ id: 'qa-saved', originalUrl: before, resultUrl: after, provider: 'QA fixture', styleSlug: 'modern', styleName: { ru: 'Тестовая комната', en: 'Test room' }, createdAt: Date.now() }] } }));
  await page.route('**/api/generate', async route => {
    const body = route.request().postDataBuffer();
    const profile = field(body, 'testProfile');
    requests.push({ profile, scope: field(body, 'scope'), quality: field(body, 'quality') });
    await gate;
    const result = { id: `qa-${requests.length}`, originalUrl: before, resultUrl: after, provider: 'nano-banana', testProfile: profile, estimatedCostRub: 9.75, durationMs: 11000, status: 'done', styleId: 'style_modern', styleName: { ru: 'Современный', en: 'Modern' } };
    history.unshift(result);
    await route.fulfill({ json: { ok: true, isDemo: false, generations: [result] } });
  });
}
function pixel(buffer, x, y) {
  const png = PNG.sync.read(buffer);
  const at = (Math.floor(png.height * y) * png.width + Math.floor(png.width * x)) * 4;
  return [...png.data.subarray(at, at + 3)];
}
const isRed = rgb => rgb[0] > 180 && rgb[1] < 100 && rgb[2] < 100;
const isBlue = rgb => rgb[2] > 170 && rgb[0] < 90;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); await wire(page);
  const identityChecks = [];
  await page.route('**/api/admin/telegram*', route => {
    const request = route.request();
    const probe = new URL(request.url()).searchParams.get('probe') === '1';
    identityChecks.push({ method: request.method(), probe });
    if (request.method() !== 'GET') return route.abort();
    return route.fulfill({ json: {
      configured: true, connected: false, username: 'interier_home_bot', publicOrigin: null, bypassConfigured: false,
      ...(probe ? {
        identity: { matches: false, code: 'username_mismatch', expectedUsername: 'interier_home_bot', actualUsername: 'another_home_bot', botIdMatches: true, usernameMatches: false,
          message: 'Telegram сообщил бота @another_home_bot, а сайт настроен на @interier_home_bot. Webhook не изменён.' },
        webhook: { ok: false, code: 'other_deployment', url: 'https://preview.example.test/api/auth/telegram/webhook', expectedUrl: 'https://smoke.example.test/api/auth/telegram/webhook',
          host: 'preview.example.test', expectedHost: 'smoke.example.test', hadBypass: false, matches: false, sameDeployment: false, pendingUpdates: 2,
          lastError: null, lastErrorAt: null, lastSyncErrorAt: null, maxConnections: 5, allowedUpdates: ['message'], originSource: 'VERCEL_BRANCH_URL',
          message: 'Webhook сейчас на preview.example.test — сообщения обрабатывает другой адрес.' },
        app: { botsEnabled: true, appEnabled: true, simulator: false, inlineGeneration: false, tokenSource: 'env', name: 'Interier — дизайн интерьера', profileAppliedAt: null },
      } : {}),
    } });
  });
  await page.goto(`${base}/login`);
  await page.locator('input[type="email"]').fill('model-lab-smoke@example.test');
  await page.locator('input[type="password"]').fill('local-model-lab-only-2026');
  await page.locator('form button.btn-primary').click();
  await page.waitForURL(/\/studio/);
  const token = new URL(page.url()).searchParams.get('ses');
  const adminUrl = `${base}/admin${token ? `?ses=${encodeURIComponent(token)}` : ''}`;
  await page.goto(adminUrl);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await expect(page.locator('#automation-secret-helper')).toBeVisible();
  const mutations = [];
  const trackMutation = request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) mutations.push(request.url()); };
  page.on('request', trackMutation);
  await page.getByRole('button', { name: 'Создать и скопировать ключ для Vercel', exact: true }).click();
  const localSecret = page.locator('#local-automation-secret');
  await expect(localSecret).toHaveAttribute('type', 'password');
  await expect(localSecret).toHaveAttribute('readonly', '');
  const generated = await localSecret.inputValue();
  assert.match(generated, /^[0-9a-f]{32}$/);
  await expect(page.locator('#automation-secret-helper')).toContainText('Скопировано.');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), generated);
  await page.locator('#automation-secret-helper').getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(localSecret).toHaveAttribute('type', 'text');
  await page.locator('#automation-secret-helper').getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(localSecret).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Убрать с экрана', exact: true }).click();
  await expect(localSecret).toHaveCount(0);
  assert.deepEqual(mutations, [], 'Creating/copying a local secret must not submit data or change settings');
  page.off('request', trackMutation);
  assert.ok(!identityChecks.some(check => check.probe), 'Opening settings must not run a remote identity probe');
  await page.getByRole('button', { name: 'Проверить webhook_info', exact: true }).click();
  await expect(page.locator('#telegram-identity-report')).toContainText('@another_home_bot');
  await expect(page.locator('#telegram-identity-report')).toContainText('@interier_home_bot');
  // The probe must also show who owns the webhook right now.
  await expect(page.locator('#telegram-webhook-report')).toContainText('preview.example.test');
  await expect(page.locator('#telegram-webhook-report')).toContainText('other_deployment');
  assert.equal(identityChecks.filter(check => check.probe).length, 1);
  assert.ok(identityChecks.every(check => check.method === 'GET'), 'Identity inspection must not change webhook settings');
  await expect(page.locator('#global-model-choice')).toHaveValue('gpt-image-2:low');
  await page.locator('#global-model-choice').selectOption('nano-banana:standard');
  await page.getByRole('button', { name: 'Применить для всех', exact: true }).click();
  await expect(page.locator('#global-generation-profile')).toContainText('Сохранено.');
  let status = await (await page.request.get(`${base}/api/admin/genstatus`, { headers: token ? { 'x-session-token': token } : {} })).json();
  assert.equal(status.model, 'nano-banana');
  await page.locator('#global-model-choice').selectOption('gpt-image-2:low');
  await page.getByRole('button', { name: 'Применить для всех', exact: true }).click();
  await expect(page.locator('#global-generation-profile')).toContainText('Сохранено.');
  status = await (await page.request.get(`${base}/api/admin/genstatus`, { headers: token ? { 'x-session-token': token } : {} })).json();
  assert.equal(status.model, 'gpt-image-2');
  assert.equal(requests.length, 0, 'Applying a profile must not generate an image');
  await expect(page.locator('#lab-model')).toHaveValue('gpt-image-2');
  await expect(page.locator('#lab-variant')).toHaveValue('gpt-image-2:medium');
  await expect(page.locator('#lab-variant option')).toHaveCount(3);
  await page.locator('#lab-model').selectOption('nano-banana');
  await expect(page.locator('#lab-variant')).toHaveValue('nano-banana:standard');
  await expect(page.locator('.model-lab-price')).toContainText('9,75');
  await page.locator('#lab-photo').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: upload });
  const run = page.getByRole('button', { name: 'Запустить один тест', exact: true });
  await expect(run).toBeEnabled(); await run.click();
  await expect(page.locator('#lab-model')).toBeDisabled();
  await page.locator('#model-lab form').evaluate(form => form.requestSubmit());
  await expect.poll(() => requests.length).toBe(1);
  release();
  await expect(page.locator('.model-lab-result-heading')).toContainText('Nano Banana');
  assert.deepEqual(requests[0], { profile: 'nano-banana:standard', scope: 'single', quality: undefined });
  const slider = page.getByRole('slider', { name: 'Сравнение до и после' });
  const canvas = page.locator('.model-lab-output .comparison-canvas');
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  await expect(canvas.locator('.comparison-image').first()).toHaveJSProperty('complete', true);
  let shot = await canvas.screenshot();
  assert.ok(isRed(pixel(shot, .2, .5)), 'left half must show BEFORE');
  assert.ok(isBlue(pixel(shot, .8, .5)), 'right half must show AFTER');
  await slider.focus(); await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  shot = await canvas.screenshot(); assert.ok(isBlue(pixel(shot, .2, .5)), '0 must show all AFTER');
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  shot = await canvas.screenshot(); assert.ok(isRed(pixel(shot, .8, .5)), '100 must show all BEFORE');
  assert.ok(pixel(shot, .2, .1).every(v => v < 20), 'letterboxing must not leak the AFTER image behind BEFORE');
  await page.getByRole('button', { name: '50 / 50', exact: true }).click();
  const handle = await slider.boundingBox(), frame = await canvas.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + frame.width * .2, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(68);
  const expand = page.locator('.model-lab-output').getByRole('button', { name: 'Увеличить', exact: true });
  await expand.click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Приблизить изображение', exact: true }).click();
  await expect(dialog.locator('.image-viewer-scale')).toHaveText('×1.5');
  await page.screenshot({ path: path.join(artifacts, 'desktop-viewer.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  assert.equal(requests.length, 1, 'viewing must not create a paid request');
  await page.reload();
  await expect(page.locator('.model-lab-recent')).toContainText('Nano Banana');
  await page.locator('.model-lab-recent').getByRole('button', { name: 'Увеличить' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть просмотр' }).click();
  assert.equal(requests.length, 1);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage(); await wire(mobile);
  await mobile.goto(`${base}/gallery`);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Mobile page must not expand the viewport horizontally');
  await mobile.locator('.gallery-card').click();
  const mobileDialog = mobile.getByRole('dialog'); await expect(mobileDialog).toBeVisible();
  const mobileSlider = mobileDialog.getByRole('slider');
  await expect(mobileSlider).toHaveAttribute('aria-valuenow', '50');
  const grip = await mobileSlider.boundingBox(), mobileFrame = await mobileDialog.locator('.comparison-canvas').boundingBox();
  const cdp = await mobileContext.newCDPSession(mobile);
  const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
  // A complete touch gesture (rather than mixing raw touch packets with tap emulation).
  await cdp.send('Input.synthesizeScrollGesture', { x, y, xDistance: mobileFrame.width * .2, yDistance: 0, gestureSourceType: 'touch', preventFling: true, speed: 250 });
  await expect.poll(async () => Number(await mobileSlider.getAttribute('aria-valuenow'))).toBeGreaterThan(67);
  await mobileDialog.getByRole('button', { name: 'Приблизить изображение', exact: true }).tap({ timeout: 5000 });
  await expect(mobileDialog.locator('.image-viewer-scale')).toHaveText('×1.5');
  await mobileDialog.getByRole('button', { name: 'Приблизить изображение', exact: true }).tap({ timeout: 5000 });
  await expect(mobileDialog.locator('.image-viewer-scale')).toHaveText('×2');
  const scroller = mobileDialog.locator('.image-viewer-viewport');
  const oldLeft = await scroller.evaluate(el => el.scrollLeft);
  const port = await scroller.boundingBox();
  await cdp.send('Input.synthesizeScrollGesture', { x: port.x + 80, y: port.y + 180, xDistance: -50, yDistance: 0, gestureSourceType: 'touch', preventFling: true, speed: 250 });
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(oldLeft + 30);
  await mobile.screenshot({ path: path.join(artifacts, 'mobile-viewer.png') });
  await mobileDialog.getByRole('button', { name: 'Закрыть просмотр' }).tap();
  await expect(mobileDialog).toHaveCount(0);
  assert.equal(requests.length, 1);
  // UI-only Telegram fixture. Backend signatures, approval and replay are tested separately.
  let approved = false;
  let authStarts = 0;
  const purposes = new Map();
  await page.route('**/api/auth/providers', route => route.fulfill({ json: { telegram: { available: true, username: 'interier_home_bot' } } }));
  await page.route('**/api/auth/telegram/start', route => {
    const payload = route.request().postDataJSON();
    const id = (++authStarts).toString(16).padStart(32, '0');
    purposes.set(id, payload.purpose);
    return route.fulfill({ json: { ok: true, challenge: { id, secret: 'b'.repeat(64), code: 'ABCDEF', expiresAt: Date.now() + 600000, botUrl: `https://t.me/interier_home_bot?start=auth_${id}` } } });
  });
  await page.route('**/api/auth/telegram/poll', route => {
    const payload = route.request().postDataJSON();
    const status = payload.cancel ? 'denied' : !approved ? 'pending' : purposes.get(payload.id) === 'link' ? 'linked' : 'authenticated';
    return route.fulfill({ json: { ok: true, status, ...(status === 'authenticated' ? { token } : {}) } });
  });
  await page.goto(`${base}/account${token ? `?ses=${encodeURIComponent(token)}` : ''}`);
  const linkTelegram = page.getByRole('button', { name: 'Подтвердить привязку Telegram', exact: true });
  await expect(linkTelegram).toBeEnabled(); await linkTelegram.click();
  await expect(page.locator('.telegram-code')).toHaveText('ABCDEF');
  assert.ok(!(await page.getByRole('link', { name: /Открыть бота/ }).getAttribute('href')).includes('b'.repeat(64)));
  assert.ok(!(await page.content()).includes('b'.repeat(64)), 'polling secret must not appear in HTML');
  await page.getByRole('button', { name: 'Отменить вход', exact: true }).click();
  await expect(page.locator('.telegram-code')).toHaveCount(0);
  await linkTelegram.click(); await expect(page.locator('.telegram-code')).toBeVisible();
  approved = true;
  await expect(page.getByText('Telegram подтверждён и привязан.', { exact: true })).toBeVisible();
  assert.equal(purposes.get('2'.padStart(32, '0')), 'link');
  approved = false;
  await context.clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${base}/login`);
  const telegramSignIn = page.getByRole('button', { name: 'Войти через Telegram', exact: true });
  await expect(telegramSignIn).toBeEnabled(); await telegramSignIn.click();
  await expect(page.locator('.telegram-code')).toBeVisible(); approved = true;
  await page.waitForURL(/\/studio/);
  assert.equal(requests.length, 1, 'Telegram sign-in/viewing must not call generation');

  // Real local API checks: a self-asserted identity and a referral must not mint spendable access.
  const headers = token ? { 'x-session-token': token } : {};
  const adminBefore = (await (await context.request.get(`${base}/api/auth/me`, { headers })).json()).user;
  const outsider = await browser.newContext();
  const registration = await outsider.request.post(`${base}/api/auth/register`, { data: {
    email: `unverified-${Date.now()}@example.test`, password: 'local-unverified-only-2026', name: 'Unverified QA',
    referralCode: adminBefore.referralCode, isAdmin: true, identityVerifiedAt: Date.now(), identityVerifiedBy: 'telegram', telegramId: 123,
  } });
  assert.equal(registration.status(), 200);
  const registered = await registration.json();
  assert.equal(registered.verificationRequired, true);
  assert.equal(registered.referralApplied, false);
  const outsiderHeaders = { 'x-session-token': registered.token };
  const me = (await (await outsider.request.get(`${base}/api/auth/me`, { headers: outsiderHeaders })).json()).user;
  assert.equal(me.isAdmin, false); assert.equal(me.verified, false); assert.equal(me.telegramId, null);
  const blocked = await outsider.request.post(`${base}/api/generate`, { headers: outsiderHeaders, multipart: {
    file: { name: 'room.png', mimeType: 'image/png', buffer: upload }, scope: 'single', styleId: 'style_modern', verified: 'true',
  } });
  assert.equal(blocked.status(), 403); assert.equal((await blocked.json()).error, 'verification_required');
  const bonus = await outsider.request.post(`${base}/api/rewards/verify`, { headers: outsiderHeaders, data: { channel: 'telegram', username: 'invented' } });
  assert.equal(bonus.status(), 403);
  const adminAfter = (await (await context.request.get(`${base}/api/auth/me`, { headers })).json()).user;
  assert.equal(adminAfter.credits, adminBefore.credits);
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(`${base}/studio?ses=${encodeURIComponent(registered.token)}`);
  await expect(outsiderPage.getByRole('button', { name: 'Сгенерировать выбранный стиль', exact: true })).toBeDisabled();
  await outsider.close();
  assert.deepEqual(pageErrors, []);
  await mobileContext.close(); await context.close();
  console.log('PASS: model/variant selection, one-click/one-request guard, desktop drag and keyboard, exact before/after clipping, no crop/stretch leakage, modal zoom/close/focus restoration, history reopening, mobile touch and gallery reuse. No real provider request made.');
} finally { await browser.close(); }
