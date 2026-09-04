import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backupFixture } from '../test-support/backup-fixture';
import { handlePostBody } from '../controllers/handle-request';
import { backups } from './backups';
import { recipes } from './recipes';
import { backupResponseSchema, recipeResponseSchema } from '@tastory/contracts';
import { readRecipeOperations, encodeRecipeRow, recipeRows } from '../services/recipe-storage';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('automatically moves older receipts out of the working journal before the next save', () => {
  const f = backupFixture();
  vi.useFakeTimers();
  vi.setSystemTime(f.context.now());
  recipes(
    { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
    randomUUID(),
    f.context.session,
  );
  const original = readRecipeOperations(f.store)[0];
  if (!original) throw new Error('fixture');
  const rows = f.required('RecipeOperations');
  while (rows.length < 501)
    rows.push(
      encodeRecipeRow('RecipeOperations', {
        ...original,
        requestId: randomUUID(),
        state: `cancelled@${original.startedAt}`,
      }),
    );
  expect(
    recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
      randomUUID(),
      f.context.session,
    ),
  ).toMatchObject({ kind: 'saved', revision: 1 });
  f.store.archive = f.archive();
  expect(readRecipeOperations(f.store)).toHaveLength(501);
  expect(recipeRows(f.store, 'RecipeOperations')).toHaveLength(401);
});
it('routes owner backup commands through the authenticated HTTP envelope and rejects injected fields', () => {
  const f = backupFixture();
  vi.useFakeTimers();
  vi.setSystemTime(f.context.now());
  f.context.session.user.id = 'owner-sub';
  const context = {
    now: f.context.now,
    createRequestId: randomUUID,
    isEchoEnabled: false,
    deploymentVersion: 'test',
    authenticate: () => f.context.session,
    backups,
    recipes,
  };
  const id = randomUUID();
  const call = (action: string, payload = {}, requestId = randomUUID()) =>
    handlePostBody(
      JSON.stringify({ apiVersion: 1, credential: 'test-token', requestId, action, payload }),
      context,
    );
  const created = call('admin.backups.create', {}, id);
  expect(backupResponseSchema.parse(created)).toMatchObject({
    ok: true,
    requestId: id,
    data: { kind: 'backup', backup: { id } },
  });
  expect(call('admin.backups.verify', { backupId: id })).toMatchObject({ ok: true });
  expect(call('admin.backups.restore', { backupId: id })).toMatchObject({
    ok: true,
    data: { kind: 'restored' },
  });
  expect(call('admin.backups.verify', { backupId: id, workspaceId: randomUUID() })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  });
  f.context.session.user.id = 'viewer-sub';
  expect(call('admin.backups.list')).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
});
it('returns authorized paged recipe history and read-only historical snapshots through HTTP', () => {
  const f = backupFixture();
  vi.useFakeTimers();
  vi.setSystemTime(f.context.now());
  const saved = recipes(
    { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
    randomUUID(),
    f.context.session,
  );
  if (saved.kind !== 'saved') throw new Error('fixture');
  recipes(
    { action: 'recipes.archive', payload: { recipeId: saved.entityId, expectedRevision: 1 } },
    randomUUID(),
    f.context.session,
  );
  f.context.session.user.id = 'owner-sub';
  expect(
    recipes(
      { action: 'admin.recipes.archiveHistory', payload: {} },
      randomUUID(),
      f.context.session,
    ),
  ).toMatchObject({ archived: 1 });
  f.context.session.user.id = 'viewer-sub';
  const context = {
    now: f.context.now,
    createRequestId: randomUUID,
    isEchoEnabled: false,
    deploymentVersion: 'test',
    authenticate: () => f.context.session,
    recipes,
  };
  const result = handlePostBody(
    JSON.stringify({
      apiVersion: 1,
      credential: 'test',
      requestId: randomUUID(),
      action: 'recipes.version',
      payload: { recipeId: saved.entityId, revision: 1 },
    }),
    context,
  );
  expect(recipeResponseSchema.parse(result)).toMatchObject({
    ok: true,
    data: { kind: 'recipe', aggregate: { recipe: { notes: '' } }, permissions: { edit: false } },
  });
  expect(
    recipes(
      { action: 'recipes.history', payload: { recipeId: saved.entityId, beforeRevision: 2 } },
      randomUUID(),
      f.context.session,
    ),
  ).toMatchObject({ versions: [{ revision: 1 }], nextBeforeRevision: null });
  expect(() =>
    recipes(
      { action: 'admin.recipes.archiveHistory', payload: {} },
      randomUUID(),
      f.context.session,
    ),
  ).toThrow('ACCESS_DENIED');
});
