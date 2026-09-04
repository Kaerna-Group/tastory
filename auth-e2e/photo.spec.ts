import { expect, test } from '@playwright/test';
import { apiRequestSchema, PHOTO_LIMITS, PHOTO_BODY_LIMIT } from '../packages/contracts/src/index';
import type { PhotoData, PhotoInfo } from '../packages/contracts/src/index';
import { inspectJpeg } from '../apps/apps-script/src/services/jpeg';

test('owner optimizes, uploads, reloads private thumbnail and deletes the test photo', async ({
  page,
}, testInfo) => {
  let stored: PhotoInfo | null = null;
  let thumbnail: string | null = null;
  let uploaded = false,
    deleted = false;
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { id: {
    initialize(options) { this.callback = options.callback; },
    renderButton(element) { const button = document.createElement('button'); button.textContent = 'Google (тест)'; button.onclick = () => this.callback({ credential: 'synthetic-photo-credential' }); element.append(button); }, disableAutoSelect() {}
  } } };`,
    }),
  );
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = apiRequestSchema.parse(route.request().postDataJSON());
    let data: unknown;
    if (request.action === 'health')
      data = {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp: new Date().toISOString(),
        storage: 'not-configured',
        auth: 'production',
      };
    else if (request.action === 'auth.signIn' || request.action === 'auth.me')
      data = {
        user: { id: 'photo-sub', name: 'Повар', email: 'chef@gmail.com', role: 'owner' },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    else if ('credential' in request) {
      expect(request.credential).toBe('synthetic-photo-credential');
      if (request.action === 'spike.photo.upload') {
        const bytes = [...Buffer.from(request.payload.imageBase64, 'base64')];
        const thumb = [...Buffer.from(request.payload.thumbnailBase64, 'base64')];
        const dimensions = inspectJpeg(bytes, PHOTO_LIMITS.imageBytes, PHOTO_LIMITS.imageEdge);
        expect(Math.max(dimensions.width, dimensions.height)).toBe(1600);
        inspectJpeg(thumb, PHOTO_LIMITS.thumbnailBytes, PHOTO_LIMITS.thumbnailEdge);
        expect(Buffer.byteLength(route.request().postData() ?? '')).toBeLessThan(PHOTO_BODY_LIMIT);
        stored = {
          id: request.payload.uploadId,
          ...dimensions,
          bytes: bytes.length,
          thumbnailBytes: thumb.length,
          createdAt: new Date().toISOString(),
        };
        thumbnail = request.payload.thumbnailBase64;
        uploaded = true;
        data = { photo: stored, thumbnailBase64: null } satisfies PhotoData;
      } else if (request.action === 'spike.photo.delete') {
        expect(request.payload.id).toBe(stored?.id);
        stored = null;
        thumbnail = null;
        deleted = true;
        data = { photo: null, thumbnailBase64: null };
      } else data = { photo: stored, thumbnailBase64: thumbnail };
    }
    await route.fulfill({
      json: {
        ok: true,
        requestId: request.requestId,
        data,
        meta: { apiVersion: 1, schemaVersion: 0 },
      },
    });
  });
  await page.goto('/#/checks');
  await expect(page.getByRole('region', { name: 'Пробное фото' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Google (тест)' }).click();
  const panel = page.getByRole('region', { name: 'Пробное фото' });
  await expect(panel.getByLabel('Выбрать фото')).toBeEnabled();
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1600;
    const context = canvas.getContext('2d');
    if (!context) throw new Error();
    context.fillStyle = '#E6B19B';
    context.fillRect(0, 0, 2400, 1600);
    context.fillStyle = '#576953';
    context.beginPath();
    context.arc(1200, 800, 600, 0, 2 * Math.PI);
    context.fill();
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await panel.getByLabel('Выбрать фото').setInputFiles({
    name: 'test-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source, 'base64'),
  });
  await expect(panel.getByAltText('Предпросмотр выбранного фото')).toBeVisible();
  await panel.getByRole('button', { name: 'Загрузить и проверить' }).click();
  await expect(panel.getByAltText('Миниатюра, полученная из приватного хранилища')).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('Миниатюра получена');
  expect(uploaded).toBe(true);
  await expect(panel.getByText('Получение миниатюры:', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('photo-owner.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google (тест)' }).click();
  await expect(panel.getByAltText('Миниатюра, полученная из приватного хранилища')).toBeVisible();
  await panel.getByRole('button', { name: 'Удалить тестовое фото' }).click();
  await expect(panel.getByRole('status')).toContainText('Тестовое фото удалено');
  expect(deleted).toBe(true);
  await expect(panel.getByAltText('Миниатюра, полученная из приватного хранилища')).toHaveCount(0);
});
