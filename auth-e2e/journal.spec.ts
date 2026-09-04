import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { apiRequestSchema } from '../packages/contracts/src/index';
import type { JournalEntry } from '../packages/contracts/src/index';

async function fixture(page: Page) {
  const entries = new Map<string, JournalEntry>();
  const audit = new Set<string>();
  const checkIds: string[] = [];
  const state: { ready: boolean; interrupt: 'beforeCommit' | 'afterCommit' | null } = {
    ready: false,
    interrupt: null,
  };
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { id: {
    initialize(options) { this.callback = options.callback; },
    renderButton(element) { for (const role of ['owner', 'viewer']) {
      const button = document.createElement('button'); button.textContent = 'Google ' + role;
      button.onclick = () => this.callback({ credential: 'synthetic-' + role }); element.append(button);
    } }, disableAutoSelect() {}
  } } };`,
    }),
  );
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = apiRequestSchema.parse(route.request().postDataJSON());
    let data: unknown;
    const timestamp = new Date().toISOString();
    if (request.action === 'health')
      data = {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp,
        storage: 'not-configured',
        auth: 'production',
      };
    else if (request.action === 'auth.signIn' || request.action === 'auth.me') {
      const role = request.credential === 'synthetic-owner' ? 'owner' : 'viewer';
      data = {
        user: { id: role, email: `${role}@example.test`, name: 'Повар', role },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    } else if (request.action === 'admin.operations.list') {
      expect(request.credential).toBe('synthetic-owner');
      data = {
        kind: 'list',
        ready: state.ready,
        schemaVersion: state.ready ? 2 : 1,
        checkedAt: timestamp,
        total: entries.size,
        entries: [...entries.values()].reverse(),
      };
    } else if (request.action === 'admin.operations.initialize') {
      expect(request.credential).toBe('synthetic-owner');
      data = { kind: 'initialized', schemaVersion: 2, alreadyApplied: state.ready };
      state.ready = true;
    } else if (request.action === 'admin.operations.check') {
      expect(request.credential).toBe('synthetic-owner');
      expect(state.ready).toBe(true);
      checkIds.push(request.requestId);
      const previous = entries.get(request.requestId);
      const entry: JournalEntry = previous ?? {
        id: request.requestId,
        action: 'admin.operations.check',
        actorName: 'Владелец тетради',
        status: 'started',
        startedAt: timestamp,
        completedAt: null,
        auditRecorded: false,
        canRetry: true,
      };
      entries.set(entry.id, entry);
      audit.add(entry.id);
      entry.auditRecorded = true;
      if (state.interrupt === 'beforeCommit') {
        state.interrupt = null;
        await route.abort();
        return;
      }
      const replay = previous?.status === 'committed';
      entry.status = 'committed';
      entry.completedAt ??= timestamp;
      entry.canRetry = false;
      if (state.interrupt === 'afterCommit') {
        state.interrupt = null;
        await route.abort();
        return;
      }
      data = {
        kind: 'check',
        outcome: replay ? 'replayed' : 'committed',
        entry,
        result: { kind: 'journal-check', verified: true },
      };
    } else data = { photo: null, thumbnailBase64: null };
    await route.fulfill({
      json: {
        ok: true,
        requestId: request.requestId,
        data,
        meta: { apiVersion: 1, schemaVersion: 0 },
      },
    });
  });
  await page.goto('/#/settings');
  return { entries, audit, checkIds, state };
}

test('owner prepares the journal, verifies replay and sees one audit event; viewer sees no journal', async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  const panel = page.getByRole('region', { name: 'Журнал операций' });
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google owner' }).click();
  await panel.getByRole('button', { name: 'Открыть журнал', exact: true }).click();
  await expect(panel.getByText('Журнал ещё не подготовлен.', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Подготовить журнал', exact: true }).click();
  await expect(panel.getByText('Пока записей нет.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Проверить сохранение и повтор', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Проверка пройдена');
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel.getByText('Завершено', { exact: true })).toBeVisible();
  expect(state.entries.size).toBe(1);
  expect(state.audit.size).toBe(1);
  expect(state.checkIds).toHaveLength(2);
  expect(new Set(state.checkIds).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('journal.png') });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google viewer' }).click();
  await expect(
    page.getByRole('region', { name: 'Ваш аккаунт' }).getByText('Читатель', { exact: true }),
  ).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test('lost reply retries the same request ID without adding another entry', async ({ page }) => {
  const state = await fixture(page);
  state.state.ready = true;
  state.state.interrupt = 'afterCommit';
  await page.getByRole('button', { name: 'Google owner' }).click();
  const panel = page.getByRole('region', { name: 'Журнал операций' });
  await panel.getByRole('button', { name: 'Открыть журнал', exact: true }).click();
  await panel.getByRole('button', { name: 'Проверить сохранение и повтор', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByRole('button', { name: 'Повторить ту же проверку', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Проверка пройдена');
  expect(state.entries.size).toBe(1);
  expect(state.audit.size).toBe(1);
  expect(state.checkIds).toHaveLength(3);
  expect(new Set(state.checkIds).size).toBe(1);
});

test('an interrupted entry can be completed after reloading and signing in again', async ({
  page,
}) => {
  const state = await fixture(page);
  state.state.ready = true;
  state.state.interrupt = 'beforeCommit';
  await page.getByRole('button', { name: 'Google owner' }).click();
  const panel = page.getByRole('region', { name: 'Журнал операций' });
  await panel.getByRole('button', { name: 'Открыть журнал', exact: true }).click();
  await panel.getByRole('button', { name: 'Проверить сохранение и повтор', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Google owner' }).click();
  await panel.getByRole('button', { name: 'Открыть журнал', exact: true }).click();
  await expect(panel.getByText('Ожидает завершения', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Завершить проверку', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Проверка пройдена');
  expect(state.entries.size).toBe(1);
  expect(state.audit.size).toBe(1);
  expect(new Set(state.checkIds).size).toBe(1);
});
