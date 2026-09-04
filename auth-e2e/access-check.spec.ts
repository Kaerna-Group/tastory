import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const provider = `window.google = { accounts: { id: {
  initialize(options) { this.callback = options.callback; },
  renderButton(element) {
    for (const account of ['owner', 'stranger', 'viewer']) {
      const button = document.createElement('button'); button.textContent = 'Google ' + account;
      button.onclick = () => this.callback({ credential: 'synthetic-' + account + '-token' });
      element.append(button);
    }
  }, disableAutoSelect() {}
} } };`;

test('access recording follows actual auth outcomes across logout and downloads no identities', async ({
  page,
}, testInfo) => {
  let viewerRevoked = false;
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: provider }),
  );
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = route.request().postDataJSON() as {
      action: string;
      requestId: string;
      credential?: string;
    };
    let data;
    if (request.action === 'health')
      data = {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp: new Date().toISOString(),
        storage: 'not-configured',
        auth: 'production',
      };
    else if (request.action.startsWith('spike.photo.'))
      data = { photo: null, thumbnailBase64: null };
    else {
      const viewer = request.credential === 'synthetic-viewer-token';
      if (request.credential === 'synthetic-stranger-token' || (viewer && viewerRevoked)) {
        await route.fulfill({
          json: {
            ok: false,
            requestId: request.requestId,
            error: {
              code: 'ACCESS_DENIED',
              message: 'Доступ не разрешён. Обратитесь к владельцу тетради.',
            },
          },
        });
        return;
      }
      data = {
        user: {
          id: viewer ? 'private-viewer-sub' : 'private-owner-sub',
          email: viewer ? 'viewer@gmail.com' : 'owner@gmail.com',
          name: viewer ? 'Тестовый читатель' : 'Тестовый владелец',
          role: viewer ? 'viewer' : 'owner',
        },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
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
  await page.goto('/#/settings');
  const account = page.getByRole('region', { name: 'Ваш аккаунт' });
  await account.getByText('Проверка приглашений', { exact: true }).click();
  await account.getByRole('button', { name: 'Начать проверку', exact: true }).click();
  await account.getByRole('button', { name: 'Google owner', exact: true }).click();
  await expect(account.getByText('Тестовый владелец', { exact: true })).toBeVisible();
  await account.getByRole('button', { name: 'Проверить доступ', exact: true }).click();
  await expect(account.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  await account.getByRole('button', { name: 'Выйти', exact: true }).click();
  await account.getByRole('button', { name: 'Google owner', exact: true }).click();
  const results = account.getByRole('list', { name: 'Результаты проверки доступа' });
  await expect(
    results.getByText('Повторный вход тем же аккаунтом: Зафиксировано', { exact: true }),
  ).toBeVisible();
  await account.getByRole('button', { name: 'Выйти', exact: true }).click();
  await account.getByRole('button', { name: 'Google stranger', exact: true }).click();
  await expect(results.getByText('Отказ при входе: Зафиксировано', { exact: true })).toBeVisible();
  await account.getByRole('button', { name: 'Google viewer', exact: true }).click();
  await expect(account.getByText('Тестовый читатель', { exact: true })).toBeVisible();
  viewerRevoked = true;
  await account.getByRole('button', { name: 'Проверить доступ', exact: true }).click();
  await expect(
    results.getByText('Отказ ранее допущенному аккаунту: Зафиксировано', { exact: true }),
  ).toBeVisible();
  viewerRevoked = false;
  await account.getByRole('button', { name: 'Google viewer', exact: true }).click();
  await expect(
    results.getByText('Вход после восстановления приглашения: Зафиксировано', { exact: true }),
  ).toBeVisible();
  const downloadPending = page.waitForEvent('download');
  await account.getByRole('button', { name: 'Скачать отчёт о доступе', exact: true }).click();
  const download = await downloadPending;
  const target = testInfo.outputPath('access-check.json');
  await download.saveAs(target);
  const text = await readFile(target, 'utf8');
  const report = JSON.parse(text) as {
    checks: Record<string, boolean>;
    events: { action: string; requestId: string | null }[];
    origin: string;
    finishedAt: string | null;
  };
  expect(report.checks).toEqual({
    repeatedSignIn: true,
    deniedSignIn: true,
    revokedSession: true,
    restoredAccess: true,
  });
  expect(report.events).toHaveLength(9);
  expect(
    report.events
      .filter((event) => event.action !== 'signOut')
      .every((event) => Boolean(event.requestId)),
  ).toBe(true);
  expect(report.finishedAt).not.toBeNull();
  expect(report.origin).toBe(new URL(page.url()).origin);
  expect(text).not.toMatch(/private-|@gmail.com|synthetic-|Тестовый|credential/);
  expect(download.suggestedFilename()).toMatch(/^tastory-access-[\w-]+\.json$/);
  await expect(account.getByRole('button', { name: 'Начать проверку', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await account.screenshot({ path: testInfo.outputPath('access-check.png') });
  await account.getByRole('button', { name: 'Очистить отчёт', exact: true }).click();
  await expect(
    account.getByRole('button', { name: 'Скачать отчёт о доступе', exact: true }),
  ).toHaveCount(0);
  await expect(account.getByText('Тестовый читатель', { exact: true })).toBeVisible();
  await page.reload();
  await account.getByText('Проверка приглашений', { exact: true }).click();
  await expect(
    account.getByRole('button', { name: 'Скачать отчёт о доступе', exact: true }),
  ).toHaveCount(0);
});
