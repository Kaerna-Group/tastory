import { expect, test } from '@playwright/test';
import { apiRequestSchema, echoResponseSchema, healthResponseSchema } from '@tastory/contracts';

const apiURL = process.env['STAGING_API_URL'] ?? '';
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiURL)) {
  throw new Error('Задайте STAGING_API_URL опубликованного Apps Script /exec.');
}

test('published app reads health after Google redirect', async ({ page, browser }, testInfo) => {
  const startedAt = Date.now();
  const requestPending = page.waitForRequest(
    (request) => request.url() === apiURL && request.method() === 'POST',
  );
  const responsePending = page.waitForResponse(
    (response) => new URL(response.url()).hostname === 'script.googleusercontent.com',
  );
  await page.goto('./#/settings');
  const request = await requestPending;
  const payload = apiRequestSchema.parse(request.postDataJSON());
  expect(payload.action).toBe('health');
  expect(request.headers()['content-type']).toBe('text/plain;charset=utf-8');
  const response = await responsePending;
  expect(response.status()).toBe(200);
  const result = healthResponseSchema.parse(await response.json());
  expect(result.requestId).toBe(payload.requestId);
  expect(result.ok).toBe(true);
  await expect(page.getByText('Проверка связи с сервером Tastory.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Соединение проверено');
  await testInfo.attach('health-evidence', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: testInfo.project.name,
        browserVersion: browser.version(),
        origin: new URL(page.url()).origin,
        durationMs: Date.now() - startedAt,
        response: result,
      },
      null,
      2,
    ),
  });
});

test('echo round trip from the published origin', async ({ page, browser }, testInfo) => {
  await page.goto('./');
  const result = await page.evaluate(async (url) => {
    const requestId = crypto.randomUUID();
    const message = 'Tastory: борщ, crème brûlée — staging ✓';
    const startedAt = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ apiVersion: 1, requestId, action: 'echo', payload: { message } }),
    });
    const body: unknown = await response.json();
    return {
      requestId,
      message,
      status: response.status,
      redirected: response.redirected,
      finalOrigin: new URL(response.url).origin,
      durationMs: Math.round(performance.now() - startedAt),
      body,
    };
  }, apiURL);
  expect(result.status).toBe(200);
  expect(result.redirected).toBe(true);
  expect(result.finalOrigin).toBe('https://script.googleusercontent.com');
  const parsed = echoResponseSchema.parse(result.body);
  expect(parsed.requestId).toBe(result.requestId);
  await testInfo.attach('echo-evidence', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: testInfo.project.name,
        browserVersion: browser.version(),
        origin: new URL(page.url()).origin,
        ...result,
      },
      null,
      2,
    ),
  });
  if (!parsed.ok && parsed.error.code === 'ACTION_DISABLED') {
    test.skip(
      process.env['REQUIRE_STAGING_ECHO'] !== 'true',
      'Echo выключен владельцем; проверка echo не закрыта.',
    );
  }
  expect(parsed.ok, 'В staging требуется ENABLE_SPIKE_ECHO=true для полного прогона.').toBe(true);
  if (parsed.ok) expect(parsed.data.message).toBe(result.message);
});
