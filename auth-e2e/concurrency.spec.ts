import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';
import { apiRequestSchema } from '../packages/contracts/src/index';
import type { ApiRequest } from '../packages/contracts/src/index';
import { applyProbe, initialProbe } from '../apps/apps-script/src/services/concurrency-probe';
import type { ProbeRecord } from '../apps/apps-script/src/services/concurrency-probe';

test('dispatches both writes together, proves conflict and deduplication, exports report', async ({
  page,
}, testInfo) => {
  const records = new Map<string, ProbeRecord>();
  const waiting: {
    route: Route;
    request: Extract<ApiRequest, { action: 'spike.concurrency.write' }>;
  }[] = [];
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { id: {
    initialize(options) { this.callback = options.callback; },
    renderButton(element) { const button = document.createElement('button'); button.textContent = 'Google (тест)'; button.onclick = () => this.callback({ credential: 'synthetic-concurrency-credential' }); element.append(button); }, disableAutoSelect() {}
  } } };`,
    }),
  );
  async function reply(route: Route, request: ApiRequest, data: unknown) {
    await route.fulfill({
      json: {
        ok: true,
        requestId: request.requestId,
        data,
        meta: { apiVersion: 1, schemaVersion: 0 },
      },
    });
  }
  async function apply(
    route: Route,
    request: Extract<ApiRequest, { action: 'spike.concurrency.read' | 'spike.concurrency.write' }>,
  ) {
    expect(request.credential).toBe('synthetic-concurrency-credential');
    const record =
      records.get(request.payload.runId) ?? initialProbe('a'.repeat(64), request.payload.runId);
    const result = applyProbe(record, request);
    if (result.changed) records.set(request.payload.runId, result.record);
    await reply(route, request, result.data);
  }
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = apiRequestSchema.parse(route.request().postDataJSON());
    if (request.action === 'health')
      await reply(route, request, {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp: new Date().toISOString(),
        storage: 'not-configured',
        auth: 'staging',
      });
    else if (request.action === 'auth.signIn' || request.action === 'auth.me')
      await reply(route, request, {
        user: { id: 'probe-owner', email: 'chef@gmail.com', name: 'Повар', role: 'owner' },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
    else if (
      request.action === 'spike.concurrency.write' &&
      request.payload.expectedRevision === 0 &&
      waiting.length < 2
    ) {
      waiting.push({ route, request });
      // Neither initial write returns until both have arrived: sequential dispatch would time out.
      if (waiting.length === 2)
        for (const pending of waiting) await apply(pending.route, pending.request);
    } else if (
      request.action === 'spike.concurrency.read' ||
      request.action === 'spike.concurrency.write'
    )
      await apply(route, request);
    else await reply(route, request, { photo: null, thumbnailBase64: null });
  });
  await page.goto('/#/settings');
  const panel = page.getByRole('region', { name: 'Одновременные изменения' });
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google (тест)' }).click();
  await panel.getByRole('button', { name: 'Проверить одновременные записи' }).click();
  await expect(panel.getByRole('status')).toContainText('Проверка пройдена');
  expect(waiting).toHaveLength(2);
  await expect(panel.getByRole('listitem')).toHaveCount(8);
  await expect(panel.getByText('Устаревшая версия отклонена', { exact: false })).toHaveCount(1);
  const final = [...records.values()][0];
  expect(final?.state.revision).toBe(2);
  expect(final?.receipts).toHaveLength(2);
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Скачать результат' }).click();
  expect((await download).suggestedFilename()).toBe(`tastory-check-${final?.state.runId}.json`);
  await page.screenshot({ path: testInfo.outputPath('concurrency-owner.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(panel).toHaveCount(0);
});
