import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { apiRequestSchema } from '../packages/contracts/src/index';
import type { AccessData } from '../packages/contracts/src/index';
type Snapshot = Extract<AccessData, { kind: 'access' }>;
async function fixture(page: Page) {
  const data: Snapshot = {
    kind: 'access',
    revision: 1,
    checkedAt: new Date().toISOString(),
    invites: [],
    pending: [],
    members: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Владелец',
        email: 'owner@example.test',
        role: 'owner',
        status: 'active',
        accountActive: true,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Читатель',
        email: 'viewer@example.test',
        role: 'viewer',
        status: 'active',
        accountActive: true,
      },
    ],
  };
  const receipts = new Map<string, Extract<AccessData, { kind: 'saved' }>>();
  const state = { loseReply: false, conflict: false, calls: [] as string[] };
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { id: {
    initialize(options) { this.callback = options.callback; },
    renderButton(element) { for (const role of ['owner','viewer']) { const button = document.createElement('button'); button.textContent = 'Google ' + role; button.onclick = () => this.callback({credential:'synthetic-'+role}); element.append(button); } }, disableAutoSelect() {}
  } } };`,
    }),
  );
  await page.route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
    const request = apiRequestSchema.parse(route.request().postDataJSON());
    const fail = (code: string, message: string) =>
      route.fulfill({
        json: { ok: false, requestId: request.requestId, error: { code, message } },
      });
    let result: unknown;
    if (request.action === 'health')
      result = {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: 'fixture',
        timestamp: new Date().toISOString(),
        storage: 'not-configured',
        auth: 'production',
      };
    else if (request.action === 'auth.signIn' || request.action === 'auth.me') {
      const role = request.credential === 'synthetic-owner' ? 'owner' : 'viewer';
      result = {
        user: { id: role, email: `${role}@example.test`, name: role, role },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    } else if (request.action === 'admin.access.list') result = data;
    else if (
      request.action === 'admin.access.resume' ||
      request.action === 'admin.invites.create' ||
      request.action === 'admin.invites.revoke' ||
      request.action === 'admin.members.update'
    ) {
      expect(request.credential).toBe('synthetic-owner');
      state.calls.push(request.requestId);
      const existing = receipts.get(request.requestId);
      if (existing) result = { ...existing, outcome: 'replayed' };
      else {
        if (state.conflict) {
          state.conflict = false;
          data.revision++;
          await fail(
            'ACCESS_CONFLICT',
            'Доступ уже изменился. Обновите список и выберите изменение заново.',
          );
          return;
        }
        if (
          'expectedRevision' in request.payload &&
          request.payload.expectedRevision !== data.revision
        ) {
          await fail('ACCESS_CONFLICT', 'Обновите список.');
          return;
        }
        let entityId = request.requestId;
        if (request.action === 'admin.invites.create') {
          data.invites.push({
            id: entityId,
            email: request.payload.email,
            role: request.payload.role,
            expiresAt: new Date(Date.now() + request.payload.days * 86400_000).toISOString(),
            status: 'pending',
          });
        } else if (request.action === 'admin.invites.revoke') {
          entityId = request.payload.inviteId;
          const invite = data.invites.find((i) => i.id === entityId);
          if (!invite) throw new Error();
          invite.status = 'revoked';
        } else if (request.action === 'admin.members.update') {
          entityId = request.payload.userId;
          const member = data.members.find((m) => m.id === entityId);
          if (!member || member.role === 'owner') throw new Error();
          member.role = request.payload.role;
          member.status = request.payload.status;
        } else {
          entityId = request.payload.operationId;
          data.pending = [];
        }
        data.revision++;
        const saved = {
          kind: 'saved' as const,
          outcome: 'committed' as const,
          operationId:
            request.action === 'admin.access.resume'
              ? request.payload.operationId
              : request.requestId,
          entityId,
          revision: data.revision,
        };
        receipts.set(request.requestId, saved);
        result = saved;
        if (state.loseReply) {
          state.loseReply = false;
          await route.abort();
          return;
        }
      }
    } else result = { photo: null, thumbnailBase64: null };
    await route.fulfill({
      json: {
        ok: true,
        requestId: request.requestId,
        data: result,
        meta: { apiVersion: 1, schemaVersion: 0 },
      },
    });
  });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Google owner' }).click();
  const panel = page.getByRole('region', { name: 'Приглашения и права' });
  await panel.getByRole('button', { name: 'Открыть управление доступом' }).click();
  await expect(panel.getByRole('heading', { name: 'Новое приглашение' })).toBeVisible();
  return { data, state, receipts, panel };
}
test('owner creates/revokes invitations and changes/restores access on desktop and mobile', async ({
  page,
}, testInfo) => {
  const { panel, data } = await fixture(page);
  await panel.getByLabel('Email Google').fill('new.long.invitation.address@example.test');
  await panel.getByLabel('Роль приглашённого').selectOption('member');
  await panel.getByRole('button', { name: 'Создать приглашение' }).click();
  await expect(panel.getByRole('status')).toContainText('Изменение сохранено');
  await expect(panel.getByRole('list', { name: 'Приглашения', exact: true })).toContainText(
    'Ожидает входа',
  );
  await panel.getByRole('button', { name: 'Отозвать приглашение' }).click();
  await expect(panel.getByRole('list', { name: 'Приглашения', exact: true })).toContainText(
    'Отозвано',
  );
  await panel.getByLabel('Роль для viewer@example.test', { exact: true }).selectOption('member');
  await panel.getByRole('button', { name: 'Сохранить роль' }).click();
  await expect(panel.getByLabel('Роль для viewer@example.test', { exact: true })).toHaveValue(
    'member',
  );
  await panel.getByRole('button', { name: 'Отключить доступ' }).click();
  await expect(panel.getByRole('list', { name: 'Управление участниками' })).toContainText(
    'Доступ отключён',
  );
  await panel.getByRole('button', { name: 'Вернуть доступ' }).click();
  await expect(panel.getByRole('button', { name: 'Отключить доступ' })).toBeEnabled();
  expect(data.revision).toBe(6);
  await expect(panel.getByText('Владелец · защищён от отключения')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('access-admin.png') });
  await expect(page.getByRole('link', { name: 'Перейти к содержанию' })).not.toBeFocused();
  await panel.getByRole('heading', { name: 'Приглашения и права' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('access-admin-viewport.png') });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Google viewer' }).click();
  await expect(
    page.getByRole('region', { name: 'Ваш аккаунт' }).getByText('Читатель', { exact: true }),
  ).toBeVisible();
  await expect(panel).toHaveCount(0);
});
test('lost mutation reply retains its key; stale revisions require a fresh choice', async ({
  page,
}) => {
  const { panel, state, data } = await fixture(page);
  state.loseReply = true;
  await panel.getByLabel('Email Google').fill('guest@example.test');
  await panel.getByRole('button', { name: 'Создать приглашение' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByRole('button', { name: 'Повторить это изменение' }).click();
  await expect(panel.getByRole('status')).toContainText('Повтор не создал дубликат');
  expect(data.invites).toHaveLength(1);
  expect(state.calls[0]).toBe(state.calls[1]);
  state.conflict = true;
  await panel.getByLabel('Роль для viewer@example.test', { exact: true }).selectOption('member');
  await panel.getByRole('button', { name: 'Сохранить роль' }).click();
  await expect(panel.getByRole('alert')).toContainText('Обновите список');
  await expect(panel.getByRole('button', { name: 'Повторить это изменение' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Открыть управление доступом' }).click();
  await expect(panel.getByLabel('Роль для viewer@example.test', { exact: true })).toHaveValue(
    'viewer',
  );
});
test('after reload an interrupted operation blocks new writes until explicitly completed', async ({
  page,
}) => {
  const { panel, data } = await fixture(page);
  data.pending = [
    { id: '33333333-3333-4333-8333-333333333333', action: 'auth.invite.accept', canResume: true },
  ];
  await page.reload();
  await page.getByRole('button', { name: 'Google owner' }).click();
  await panel.getByRole('button', { name: 'Открыть управление доступом' }).click();
  await expect(panel.getByRole('button', { name: 'Создать приглашение' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Завершить изменение' }).click();
  await expect(panel.getByRole('status')).toContainText('Изменение сохранено');
  await expect(panel.getByRole('button', { name: 'Создать приглашение' })).toBeEnabled();
});
