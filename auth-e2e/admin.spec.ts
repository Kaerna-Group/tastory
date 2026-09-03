import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { apiRequestSchema } from '../packages/contracts/src/index';

async function fixture(page: Page) {
  const state = { deny: false, fail: false, adminCalls: 0 };
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
    const common = {
      workspace: { id: '33333333-3333-4333-8333-333333333333', name: 'Семейная тетрадь' },
      checkedAt: new Date().toISOString(),
    };
    let data: unknown;
    if (request.action === 'health')
      data = {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp: common.checkedAt,
        storage: 'not-configured',
        auth: 'staging',
      };
    else if (request.action === 'auth.signIn' || request.action === 'auth.me') {
      const role = request.credential === 'synthetic-owner' ? 'owner' : 'viewer';
      data = {
        user: { id: role, name: 'Повар', email: `${role}@example.test`, role },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    } else if (request.action === 'admin.users.list' || request.action === 'admin.health') {
      state.adminCalls += 1;
      expect(request.credential).toBe('synthetic-owner');
      expect(request.payload).toEqual({});
      if (state.fail || state.deny) {
        await route.fulfill({
          json: {
            ok: false,
            requestId: request.requestId,
            error: {
              code: state.deny ? 'ACCESS_DENIED' : 'ADMIN_UNAVAILABLE',
              message: state.deny
                ? 'Доступ закрыт.'
                : 'Не удалось прочитать данные тетради. Попробуйте позже.',
            },
          },
        });
        return;
      }
      data =
        request.action === 'admin.health'
          ? {
              ...common,
              status: 'ok',
              schemaVersion: 1,
              tablesChecked: 6,
              members: 2,
              activeMembers: 1,
            }
          : {
              ...common,
              users: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  email: 'owner@example.test',
                  displayName: 'Анна',
                  role: 'owner',
                  userStatus: 'active',
                  membershipStatus: 'active',
                  joinedAt: common.checkedAt,
                },
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  email: 'long.viewer.address.for.mobile.layout@example.test',
                  displayName: '',
                  role: 'viewer',
                  userStatus: 'active',
                  membershipStatus: 'disabled',
                  joinedAt: common.checkedAt,
                },
              ],
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
  return state;
}

test('owner reads participants and schema health, then logout removes the directory', async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  const panel = page.getByRole('region', { name: 'Участники тетради' });
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google owner' }).click();
  await expect(panel).toBeVisible();
  expect(state.adminCalls).toBe(0);
  await panel.getByRole('button', { name: 'Показать участников' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByText('Анна', { exact: true })).toBeVisible();
  await expect(panel.getByText('Доступ отключён', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Проверить таблицы' }).click();
  await expect(panel.getByRole('status')).toContainText('Структура таблиц в порядке');
  await expect(panel.getByRole('status')).toContainText('Доступ открыт: 1 из 2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('workspace-admin.png') });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google viewer' }).click();
  await expect(
    page.getByRole('region', { name: 'Ваш аккаунт' }).getByText('Читатель', { exact: true }),
  ).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(state.adminCalls).toBe(2);
  await expect(page.getByText('Анна', { exact: true })).toHaveCount(0);
});

test('refresh failure clears stale members and revocation removes the owner panel', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Google owner' }).click();
  const panel = page.getByRole('region', { name: 'Участники тетради' });
  await panel.getByRole('button', { name: 'Показать участников' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  state.fail = true;
  await panel.getByRole('button', { name: 'Обновить список' }).click();
  await expect(panel.getByRole('alert')).toContainText('Не удалось прочитать');
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  state.fail = false;
  await panel.getByRole('button', { name: 'Показать участников' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  state.deny = true;
  await panel.getByRole('button', { name: 'Проверить таблицы' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Ваш аккаунт' }).getByRole('status')).toHaveText(
    'Доступ закрыт.',
  );
});
