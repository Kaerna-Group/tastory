import { expect, test } from '@playwright/test';
const googleFixture = `window.google = { accounts: { id: {
  initialize(options) { this.callback = options.callback; },
  renderButton(element) {
    const button = document.createElement('button'); button.textContent = 'Google (тест)';
    button.onclick = () => this.callback({ credential: 'synthetic-test-credential' });
    element.append(button);
  }, disableAutoSelect() {}
} } };`;

test('sign-in, recheck, revocation, retry and logout with provider fixtures', async ({ page }) => {
  const actions: string[] = [];
  let revoked = false;
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: googleFixture }),
  );
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = route.request().postDataJSON() as {
      requestId: string;
      action: string;
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
        auth: 'staging',
      };
    else if (request.action.startsWith('spike.photo.'))
      data = { photo: null, thumbnailBase64: null };
    else {
      actions.push(request.action);
      expect(request.credential).toBe('synthetic-test-credential');
      expect(route.request().headers()['content-type']).toBe('text/plain;charset=utf-8');
      if (revoked) {
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
          id: 'synthetic-sub',
          email: 'chef@gmail.com',
          name: 'Тестовый повар',
          role: 'owner',
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
  await account.getByRole('button', { name: 'Google (тест)' }).click();
  await expect(account.getByText('Тестовый повар')).toBeVisible();
  await account.getByRole('button', { name: 'Проверить доступ' }).click();
  await expect(account.getByText('Вход выполнен. Доступ подтверждён.')).toBeVisible();
  expect(actions).toEqual(['auth.signIn', 'auth.me']);
  revoked = true;
  await account.getByRole('button', { name: 'Проверить доступ' }).click();
  await expect(account.getByText('Доступ не разрешён.', { exact: false })).toBeVisible();
  await expect(account.getByText('Тестовый повар')).toHaveCount(0);
  revoked = false;
  await account.getByRole('button', { name: 'Google (тест)' }).click();
  await expect(account.getByText('Тестовый повар')).toBeVisible();
  await account.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(account.getByRole('button', { name: 'Google (тест)' })).toBeVisible();
  await account.getByRole('button', { name: 'Google (тест)' }).click();
  await expect(account.getByText('Тестовый повар')).toBeVisible();
  await page.reload();
  await expect(account.getByRole('button', { name: 'Google (тест)' })).toBeVisible();
  await expect(account.getByText('Тестовый повар')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Google script failure offers a retry', async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', (route) => route.abort());
  await page.route('https://script.google.com/**', (route) => route.abort());
  await page.goto('/#/settings');
  await expect(page.getByRole('alert')).toContainText('Кнопка Google не загрузилась');
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: googleFixture }),
  );
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByRole('button', { name: 'Google (тест)' })).toBeVisible();
});
