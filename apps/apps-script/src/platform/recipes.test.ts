import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { recipeResponseSchema } from '@tastory/contracts';
import { recipes } from './recipes';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { timestamp, owner, workspace } from '../test-support/journal-fixture';
import { readAdminDirectory } from './admin-directory';
import { operationJournal } from './operation-journal';
import { manageAccess } from './access-admin';
import { authenticateSheets } from './workspace-directory';
import { handlePostBody, handleRequest } from '../controllers/handle-request';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(initialize = true) {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  return persistenceFixture(initialize);
}
describe('recipe platform and HTTP', () => {
  it('stores personal favorites idempotently and returns searchable lightweight summaries', () => {
    const f = setup();
    const created = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (created.kind !== 'saved') throw new Error('fixture');
    const requestId = randomUUID();
    expect(
      recipes(
        {
          action: 'recipes.favorite.set',
          payload: { recipeId: created.entityId, favorite: true },
        },
        requestId,
        f.context.session,
      ),
    ).toMatchObject({ kind: 'favorite', favorite: true, outcome: 'committed' });
    expect(
      recipes(
        {
          action: 'recipes.favorite.set',
          payload: { recipeId: created.entityId, favorite: true },
        },
        requestId,
        f.context.session,
      ),
    ).toMatchObject({ outcome: 'replayed' });
    expect(() =>
      recipes(
        {
          action: 'recipes.favorite.set',
          payload: { recipeId: created.entityId, favorite: false },
        },
        requestId,
        f.context.session,
      ),
    ).toThrow('OPERATION_MISMATCH');
    expect(
      recipes({ action: 'recipes.list', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({
      kind: 'recipes',
      recipes: [
        {
          id: created.entityId,
          favorite: true,
          ingredientNames: ['Соль'],
          tags: [],
          coverPhotoId: null,
        },
      ],
    });
    f.context.session.user.id = 'viewer-sub';
    expect(
      recipes({ action: 'recipes.list', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({ recipes: [{ favorite: false }] });
  });
  it('returns editing capabilities from live membership, including readers and archived recipes', () => {
    const f = setup();
    const created = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (created.kind !== 'saved') throw new Error('fixture');
    const get = () =>
      recipes(
        { action: 'recipes.get', payload: { recipeId: created.entityId } },
        randomUUID(),
        f.context.session,
      );
    expect(get()).toMatchObject({ permissions: { edit: true, archive: true, restore: false } });
    f.context.session.user.id = 'viewer-sub';
    expect(get()).toMatchObject({ permissions: { edit: false, archive: false, restore: false } });
    f.context.session.user.id = 'author-sub';
    recipes(
      { action: 'recipes.archive', payload: { recipeId: created.entityId, expectedRevision: 1 } },
      randomUUID(),
      f.context.session,
    );
    expect(get()).toMatchObject({ permissions: { edit: false, archive: false, restore: true } });
  });
  it('lists and resumes complete operations and cancels incomplete operations through the platform', () => {
    const f = setup();
    const firstId = randomUUID();
    f.fail(9);
    expect(() =>
      recipes(
        { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
        firstId,
        f.context.session,
      ),
    ).toThrow('RECIPE_UNAVAILABLE');
    f.fail();
    expect(
      recipes({ action: 'recipes.operations.list', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({
      kind: 'operations',
      operations: [{ operationId: firstId, canResume: true }],
    });
    expect(
      recipes(
        { action: 'recipes.operations.resume', payload: { operationId: firstId } },
        randomUUID(),
        f.context.session,
      ),
    ).toMatchObject({
      kind: 'saved',
      operationId: firstId,
      outcome: 'committed',
    });
    const secondId = randomUUID();
    f.fail(3);
    expect(() =>
      recipes(
        { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
        secondId,
        f.context.session,
      ),
    ).toThrow('RECIPE_UNAVAILABLE');
    f.fail();
    expect(
      recipes(
        { action: 'recipes.operations.cancel', payload: { operationId: secondId } },
        randomUUID(),
        f.context.session,
      ),
    ).toMatchObject({ outcome: 'cancelled' });
    expect(
      recipes({ action: 'recipes.operations.list', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({ operations: [] });
    expect(
      recipes({ action: 'tags.list', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({ tags: [] });
  });
  it('initializes only for the current owner and preserves existing auth/admin/journal/access', () => {
    const f = setup(false);
    expect(() =>
      recipes({ action: 'admin.recipes.initialize', payload: {} }, randomUUID(), f.context.session),
    ).toThrow('ACCESS_DENIED');
    f.context.session.user.id = 'owner-sub';
    expect(
      recipes({ action: 'admin.recipes.initialize', payload: {} }, randomUUID(), f.context.session),
    ).toEqual({ kind: 'initialized', schemaVersion: 9, alreadyApplied: false });
    expect(
      recipes({ action: 'admin.recipes.initialize', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({ alreadyApplied: true });
    expect(readAdminDirectory('admin.health', f.context.session)).toMatchObject({
      schemaVersion: 9,
      tablesChecked: 25,
    });
    expect(
      operationJournal('admin.operations.list', randomUUID(), f.context.session),
    ).toMatchObject({ schemaVersion: 2, ready: true });
    expect(
      operationJournal('admin.operations.initialize', randomUUID(), f.context.session),
    ).toMatchObject({ schemaVersion: 2, alreadyApplied: true });
    expect(
      operationJournal('admin.operations.check', randomUUID(), f.context.session),
    ).toMatchObject({ kind: 'check' });
    expect(
      manageAccess({ action: 'admin.access.list', payload: {} }, randomUUID(), f.context.session),
    ).toMatchObject({ kind: 'access' });
    f.hold();
    expect(
      authenticateSheets(
        {
          sub: 'owner-sub',
          email: 'owner@example.test',
          name: 'Owner',
          expiresAt: '2026-09-03T13:00:00Z',
          emailAuthoritative: true,
        },
        JSON.stringify({ version: 1, backend: 'sheets', workspaceId: workspace }),
        'private-sheet',
      ),
    ).toMatchObject({ user: { role: 'owner' } });
    expect(owner).toBeDefined();
  });
  it('runs HTTP create/get/update/archive/restore and preserves IDs and large recipe bodies', () => {
    const f = setup();
    const context = {
      now: f.context.now,
      createRequestId: randomUUID,
      isEchoEnabled: false,
      deploymentVersion: 'test',
      authenticate: () => f.context.session,
      recipes,
    };
    f.value.content.notes = 'д'.repeat(10000);
    const requestId = randomUUID();
    const request = {
      apiVersion: 1,
      requestId,
      action: 'recipes.create',
      credential: 'test-token',
      payload: { value: f.value },
    };
    const response = recipeResponseSchema.parse(handlePostBody(JSON.stringify(request), context));
    if (!response.ok || response.data.kind !== 'saved') throw new Error(JSON.stringify(response));
    const recipeId = response.data.entityId;
    expect(response.requestId).toBe(requestId);
    expect(handleRequest(request, context)).toMatchObject({
      data: { outcome: 'replayed', entityId: recipeId },
    });
    expect(
      handleRequest(
        { ...request, requestId: randomUUID(), action: 'recipes.get', payload: { recipeId } },
        context,
      ),
    ).toMatchObject({
      data: { kind: 'recipe', aggregate: { recipe: { id: recipeId, revision: 1 } } },
    });
    expect(
      handleRequest(
        {
          ...request,
          requestId: randomUUID(),
          action: 'recipes.updateContent',
          payload: { recipeId, expectedRevision: 1, value: f.value },
        },
        context,
      ),
    ).toMatchObject({ data: { revision: 2 } });
    expect(
      handleRequest(
        {
          ...request,
          requestId: randomUUID(),
          action: 'recipes.archive',
          payload: { recipeId, expectedRevision: 2 },
        },
        context,
      ),
    ).toMatchObject({ data: { revision: 3 } });
    expect(
      handleRequest(
        {
          ...request,
          requestId: randomUUID(),
          action: 'recipes.restore',
          payload: { recipeId, expectedRevision: 3 },
        },
        context,
      ),
    ).toMatchObject({ data: { revision: 4 } });
    expect(f.release).toHaveBeenCalled();
    f.context.session.user.id = 'viewer-sub';
    expect(handleRequest({ ...request, requestId: randomUUID() }, context)).toMatchObject({
      ok: false,
      error: { code: 'ACCESS_DENIED' },
    });
    expect(
      handleRequest(
        { ...request, requestId: randomUUID(), action: 'recipes.list', payload: {} },
        context,
      ),
    ).toMatchObject({ data: { recipes: [] } });
  });
  it('does not route recipe reads/writes through the owner-only diagnostic guard', () => {
    const f = setup();
    f.context.session.user.role = 'member';
    const context = {
      now: f.context.now,
      createRequestId: randomUUID,
      isEchoEnabled: false,
      deploymentVersion: 'test',
      authenticate: () => f.context.session,
      recipes,
    };
    const request = {
      apiVersion: 1,
      requestId: randomUUID(),
      action: 'recipes.create',
      credential: 'token',
      payload: { value: f.value },
    };
    expect(handleRequest(request, context)).toMatchObject({ ok: true, data: { kind: 'saved' } });
    expect(
      handleRequest({ ...request, action: 'admin.recipes.initialize', payload: {} }, context),
    ).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
    expect(handleRequest({ ...request, credential: undefined }, context)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
  });
  it('fails closed before initialization, on lock failure, expired sessions and damaged storage', () => {
    const f = setup(false);
    expect(() =>
      recipes({ action: 'recipes.list', payload: {} }, randomUUID(), f.context.session),
    ).toThrow('RECIPE_NOT_READY');
    f.lock.mockReturnValueOnce(false);
    expect(() =>
      recipes({ action: 'recipes.list', payload: {} }, randomUUID(), f.context.session),
    ).toThrow('RECIPE_UNAVAILABLE');
    f.context.session.expiresAt = timestamp;
    expect(() =>
      recipes({ action: 'recipes.list', payload: {} }, randomUUID(), f.context.session),
    ).toThrow('UNAUTHENTICATED');
    const g = setup();
    g.formulas.add('Recipes');
    expect(() =>
      recipes({ action: 'recipes.list', payload: {} }, randomUUID(), g.context.session),
    ).toThrow('RECIPE_UNAVAILABLE');
  });
  it('exposes only stable errors and limits large inputs to recipe writes', () => {
    const f = setup();
    const context = {
      now: f.context.now,
      createRequestId: randomUUID,
      isEchoEnabled: false,
      deploymentVersion: 'test',
      authenticate: () => f.context.session,
    };
    const request = {
      apiVersion: 1,
      requestId: randomUUID(),
      action: 'recipes.list',
      credential: 'token',
      payload: {},
    };
    expect(handleRequest(request, context)).toMatchObject({ error: { code: 'RECIPE_NOT_READY' } });
    expect(
      handleRequest(request, {
        ...context,
        recipes: () => {
          throw new Error('secret');
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      JSON.stringify(
        handleRequest(request, {
          ...context,
          recipes: () => {
            throw new Error('secret');
          },
        }),
      ),
    ).not.toContain('secret');
    expect(handlePostBody(JSON.stringify(request) + ' '.repeat(9000), context)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(handlePostBody(' '.repeat(2 * 1024 * 1024 + 1), context)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
  });
});
