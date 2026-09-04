import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { BackupData } from '@tastory/contracts';
const provider = `window.google = { accounts: { id: {
 initialize(options) { this.callback = options.callback; },
 renderButton(element) { const button = document.createElement('button'); button.textContent = 'Google (тест)'; button.onclick = () => this.callback({ credential: 'backup-test-token' }); element.append(button); }, disableAutoSelect() {}
} } };`;
async function fixture(page: Page, role: 'owner' | 'viewer' = 'owner') {
  const saved = new Map<string, Extract<BackupData, { kind: 'backup' }>['backup']>();
  const requests: { action: string; requestId: string }[] = [];
  let loseResponse = true;
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: provider }),
  );
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = route.request().postDataJSON() as {
      action: string;
      requestId: string;
      payload: { backupId?: string };
    };
    let data: unknown;
    if (request.action.startsWith('auth.'))
      data = {
        user: { id: 'owner-sub', email: 'owner@example.test', name: 'Повар', role },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    else if (request.action === 'recipes.list') data = { kind: 'recipes', recipes: [] };
    else if (request.action === 'health')
      data = {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp: new Date().toISOString(),
        storage: 'not-configured',
        auth: 'production',
      };
    else if (request.action === 'admin.recipes.archiveHistory')
      data = { kind: 'archivedHistory', archived: 100, totalArchived: 100, active: 2 };
    else if (request.action.startsWith('admin.backups.')) {
      requests.push(request);
      if (request.action === 'admin.backups.create') {
        if (!saved.has(request.requestId))
          saved.set(request.requestId, {
            id: request.requestId,
            createdAt: new Date().toISOString(),
            tables: 14,
            files: 3,
            hash: 'a'.repeat(64),
          });
        data = { kind: 'backup', backup: saved.get(request.requestId) };
        if (loseResponse) {
          loseResponse = false;
          await route.abort();
          return;
        }
      } else if (request.action === 'admin.backups.list')
        data = { kind: 'backups', backups: [...saved.values()], incomplete: [] };
      else if (request.action === 'admin.backups.verify')
        data = { kind: 'backup', backup: saved.get(request.payload.backupId ?? '') };
      else
        data = {
          kind: 'restored',
          backup: saved.get(request.payload.backupId ?? ''),
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/restored/edit',
          folderUrl: 'https://drive.google.com/drive/folders/restored',
          configurationUrl: 'https://drive.google.com/file/d/config',
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
  await page.goto('/#/checks');
  await page.getByRole('button', { name: 'Google (тест)' }).click();
  return { saved, requests };
}
test('backup survives a lost response and reload, then verifies and restores to separate resources', async ({
  page,
}) => {
  const f = await fixture(page);
  const panel = page.getByRole('region', { name: 'Резервные копии' });
  await panel.getByRole('button', { name: 'Создать резервную копию' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Google (тест)' }).click();
  await panel.getByRole('button', { name: 'Создать резервную копию' }).click();
  await expect(panel.getByRole('status')).toContainText('Копия проверена');
  expect(f.saved.size).toBe(1);
  const creates = f.requests.filter((request) => request.action === 'admin.backups.create');
  expect(creates[0]?.requestId).toBe(creates[1]?.requestId);
  await panel.getByRole('button', { name: 'Открыть копии' }).click();
  await panel.getByRole('button', { name: 'Проверить копию', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Копия проверена');
  await panel.getByRole('button', { name: 'Открыть копии' }).click();
  await panel.getByRole('button', { name: 'Восстановить отдельно' }).click();
  await expect(panel.getByRole('link', { name: 'Восстановленная книга' })).toHaveAttribute(
    'href',
    'https://docs.google.com/spreadsheets/d/restored/edit',
  );
  await panel.getByRole('button', { name: 'Архивировать историю' }).click();
  await expect(panel.getByText('в архиве 100 операций', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('viewer does not get backup or history maintenance controls', async ({ page }) => {
  await fixture(page, 'viewer');
  await expect(page.getByRole('heading', { name: 'Резервные копии', exact: true })).toHaveCount(0);
});
