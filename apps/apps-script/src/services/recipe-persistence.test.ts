import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { recipeAggregateSchema } from '@tastory/contracts';
import type { RecipeMutation, RecipeAggregate } from '@tastory/contracts';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { other, owner, sha256 } from '../test-support/journal-fixture';
import {
  mutateRecipe,
  resumeRecipeOperation,
  cancelRecipeOperation,
  listRecipeOperations,
} from './recipe-mutations';
import {
  recipeRows,
  readRecipeOperations,
  canonicalRecipeJson,
  encodeRecipeRow,
} from './recipe-storage';
import { readRecipeAggregate, listRecipeSummaries, authorizeRecipeObject } from './recipe-model';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const aggregate = (f: ReturnType<typeof persistenceFixture>, id: string): RecipeAggregate =>
  recipeAggregateSchema.parse(f.reader().getAggregate(id));
function setup() {
  const f = persistenceFixture();
  const tag = mutateRecipe(
    f.context,
    { action: 'tags.create', payload: { name: 'Супы', colorToken: 'neutral' } },
    randomUUID(),
  );
  f.value.tagIds = [tag.entityId];
  f.fail();
  const create: RecipeMutation = {
    action: 'recipes.create',
    payload: { value: f.value, visibility: 'private' },
  };
  return { ...f, create };
}

describe('durable recipe storage', () => {
  it('looks up stored children through their current committed recipe and enforces object rights', () => {
    const f = setup();
    const saved = mutateRecipe(f.context, f.create, randomUUID());
    const recipe = aggregate(f, saved.entityId);
    const ingredient = recipe.ingredients[0],
      step = recipe.steps[0],
      tag = recipe.tags[0];
    if (!ingredient || !step || !tag) throw new Error('fixture');
    expect(
      authorizeRecipeObject(f.model(), { kind: 'ingredient', id: ingredient.id, action: 'read' }),
    ).toEqual(ingredient);
    expect(authorizeRecipeObject(f.model(), { kind: 'step', id: step.id, action: 'read' })).toEqual(
      step,
    );
    expect(
      authorizeRecipeObject(f.model(), {
        kind: 'recipeTag',
        recipeId: saved.entityId,
        tagId: tag.id,
        action: 'read',
      }),
    ).toEqual(recipe.recipeTags[0]);
    expect(f.reader().getIngredient(randomUUID())).toBeNull();
    f.context.session.user.id = 'viewer-sub';
    expect(() =>
      authorizeRecipeObject(f.model(), { kind: 'step', id: step.id, action: 'read' }),
    ).toThrow('ACCESS_DENIED');
  });
  it('resumes a partially written range without duplicating its completed prefix', () => {
    const f = setup(),
      requestId = randomUUID();
    const firstStep = f.value.steps[0];
    if (!firstStep) throw new Error('fixture');
    f.value.steps.push({ ...firstStep, position: 1, body: 'Подать' });
    const writeRows = f.store.writeRows;
    let interrupted = false;
    f.store.writeRows = (table, row, values) => {
      if (table === 'RecipeSteps' && values.length === 2 && !interrupted) {
        interrupted = true;
        writeRows(table, row, values.slice(0, 1));
        throw new Error('partial range');
      }
      writeRows(table, row, values);
    };
    expect(() => mutateRecipe(f.context, f.create, requestId)).toThrow('partial range');
    expect(listRecipeSummaries(f.model())).toEqual([]);
    const result = mutateRecipe(f.context, f.create, requestId);
    expect(aggregate(f, result.entityId).steps).toHaveLength(2);
    expect(recipeRows(f.store, 'RecipeSteps')).toHaveLength(2);
  });
  it('rejects new operations at capacity while retaining read and replay access', () => {
    const f = setup(),
      requestId = randomUUID();
    const saved = mutateRecipe(f.context, f.create, requestId);
    const original = readRecipeOperations(f.store).find((op) => op.requestId === requestId);
    if (!original) throw new Error('fixture');
    const rows = f.required('RecipeOperations');
    while (rows.length < 10001)
      rows.push(
        encodeRecipeRow('RecipeOperations', {
          ...original,
          requestId: randomUUID(),
          state: `cancelled@${original.startedAt}`,
        }),
      );
    f.fail();
    expect(() => mutateRecipe(f.context, f.create, randomUUID())).toThrow('RECIPE_LIMIT');
    expect(f.count()).toBe(0);
    expect(aggregate(f, saved.entityId).recipe.title).toBe('Новый суп');
    expect(mutateRecipe(f.context, f.create, requestId).outcome).toBe('replayed');
  }, 15000);
  it('does not publish a tag whose author was removed while the operation was pending', () => {
    const f = persistenceFixture(),
      requestId = randomUUID();
    f.fail(5);
    expect(() =>
      mutateRecipe(
        f.context,
        { action: 'tags.create', payload: { name: 'Супы', colorToken: 'neutral' } },
        requestId,
      ),
    ).toThrow();
    f.fail();
    const users = f.required('Users'),
      members = f.required('WorkspaceMembers');
    users.splice(
      users.findIndex((row) => row[0] === other),
      1,
    );
    members.splice(
      members.findIndex((row) => row[1] === other),
      1,
    );
    f.context.session.user.id = 'owner-sub';
    expect(() => resumeRecipeOperation(f.context, requestId)).toThrow('RECIPE_UNAVAILABLE');
    expect(f.reader().listTags(f.context.workspaceId)).toEqual([]);
    expect(cancelRecipeOperation(f.context, requestId).outcome).toBe('cancelled');
  });
  it('does not publish when the session expires between table writes', () => {
    const f = setup(),
      requestId = randomUUID();
    const writeRows = f.store.writeRows;
    f.store.writeRows = (table, row, values) => {
      writeRows(table, row, values);
      if (table === 'Recipes') f.context.session.expiresAt = f.context.now().toISOString();
    };
    expect(() => mutateRecipe(f.context, f.create, requestId)).toThrow('UNAUTHENTICATED');
    expect(f.reader().listRecipes(f.context.workspaceId)).toEqual([]);
    f.store.writeRows = writeRows;
    f.context.session.expiresAt = '2026-09-03T13:00:00Z';
    expect(mutateRecipe(f.context, f.create, requestId).outcome).toBe('committed');
  });
  it('persists a complete recipe, updates children, archives/restores and reads with a fresh repository', () => {
    const f = setup();
    const created = mutateRecipe(f.context, f.create, randomUUID());
    const first = aggregate(f, created.entityId);
    expect(first.recipe).toMatchObject({
      title: 'Новый суп',
      ownerUserId: other,
      revision: 1,
      status: 'draft',
    });
    expect(first.tags).toHaveLength(1);
    const ingredient = first.ingredients[0];
    if (!ingredient) throw new Error('fixture');
    const update: RecipeMutation = {
      action: 'recipes.updateContent',
      payload: {
        recipeId: created.entityId,
        expectedRevision: 1,
        value: {
          ...f.value,
          content: { ...f.value.content, title: 'Обновлённый суп' },
          ingredients: [
            {
              ...f.value.ingredients[0],
              id: ingredient.id,
              position: 1,
              name: 'Перец',
              sectionTitle: '',
              quantityValue: 2,
              quantityText: '',
              unit: 'г',
              note: '',
              isOptional: true,
            },
          ],
          steps: [],
          tagIds: [],
        },
      },
    };
    const updated = mutateRecipe(f.context, update, randomUUID());
    expect(updated.revision).toBe(2);
    const second = aggregate(f, created.entityId);
    expect(second.recipe.title).toBe('Обновлённый суп');
    expect(second.ingredients[0]).toMatchObject({ id: ingredient.id, name: 'Перец', revision: 2 });
    expect(second.steps).toEqual([]);
    expect(second.recipeTags).toEqual([]);
    expect(recipeRows(f.store, 'RecipeSteps')).toHaveLength(1);
    const archived = mutateRecipe(
      f.context,
      { action: 'recipes.archive', payload: { recipeId: created.entityId, expectedRevision: 2 } },
      randomUUID(),
    );
    expect(archived.revision).toBe(3);
    expect(aggregate(f, created.entityId).recipe.status).toBe('archived');
    expect(() =>
      mutateRecipe(
        f.context,
        { ...update, payload: { ...update.payload, expectedRevision: 3 } },
        randomUUID(),
      ),
    ).toThrow('ACCESS_DENIED');
    mutateRecipe(
      f.context,
      { action: 'recipes.restore', payload: { recipeId: created.entityId, expectedRevision: 3 } },
      randomUUID(),
    );
    expect(aggregate(f, created.entityId).recipe).toMatchObject({
      status: 'draft',
      revision: 4,
      notes: 'Заметка',
    });
    expect(
      readRecipeOperations(f.store).filter((op) => op.entityId === created.entityId),
    ).toHaveLength(4);
  });

  it('replays permanent receipts after later revisions without reapplying old changes', () => {
    const f = setup(),
      requestId = randomUUID();
    const saved = mutateRecipe(f.context, f.create, requestId);
    const writes = f.count();
    expect(mutateRecipe(f.context, f.create, requestId)).toEqual({ ...saved, outcome: 'replayed' });
    expect(f.count()).toBe(writes);
    mutateRecipe(
      f.context,
      { action: 'recipes.archive', payload: { recipeId: saved.entityId, expectedRevision: 1 } },
      randomUUID(),
    );
    expect(mutateRecipe(f.context, f.create, requestId)).toMatchObject({
      revision: 1,
      outcome: 'replayed',
    });
    expect(aggregate(f, saved.entityId).recipe).toMatchObject({ revision: 2, status: 'archived' });
    expect(() =>
      mutateRecipe(
        f.context,
        {
          action: 'recipes.create',
          payload: {
            ...f.create.payload,
            value: { ...f.value, content: { ...f.value.content, title: 'Другой' } },
            visibility: 'private',
          },
        },
        requestId,
      ),
    ).toThrow('OPERATION_MISMATCH');
  });

  for (const mode of ['create', 'update', 'archive', 'restore'] as const) {
    it(`recovers ${mode} after failure before and after every write/flush`, () => {
      const scenario = () => {
        const f = setup();
        let before: RecipeAggregate | null = null;
        let command: RecipeMutation = f.create;
        if (mode !== 'create') {
          const saved = mutateRecipe(f.context, f.create, randomUUID());
          if (mode === 'restore')
            mutateRecipe(
              f.context,
              {
                action: 'recipes.archive',
                payload: { recipeId: saved.entityId, expectedRevision: 1 },
              },
              randomUUID(),
            );
          before = aggregate(f, saved.entityId);
          command =
            mode === 'update'
              ? {
                  action: 'recipes.updateContent',
                  payload: {
                    recipeId: saved.entityId,
                    expectedRevision: before.recipe.revision,
                    value: {
                      ...f.value,
                      content: { ...f.value.content, title: 'После изменения' },
                    },
                  },
                }
              : {
                  action: mode === 'archive' ? 'recipes.archive' : 'recipes.restore',
                  payload: { recipeId: saved.entityId, expectedRevision: before.recipe.revision },
                };
        }
        f.fail();
        return { f, command, before };
      };
      const measured = scenario();
      mutateRecipe(measured.f.context, measured.command, randomUUID());
      const boundaries = measured.f.count();
      expect(boundaries).toBeGreaterThan(5);
      for (const after of [false, true])
        for (let failAt = 1; failAt <= boundaries; failAt++) {
          const { f, command, before } = scenario();
          const requestId = randomUUID();
          f.fail(failAt, after);
          expect(() => mutateRecipe(f.context, command, requestId)).toThrow();
          f.fail();
          const op = readRecipeOperations(f.store).find((entry) => entry.requestId === requestId);
          const visible = op ? f.reader().getAggregate(op.entityId) : before;
          if (!op?.state.startsWith('committed@')) expect(visible).toEqual(before);
          else
            expect(recipeAggregateSchema.parse(visible).recipe.revision).toBe(
              (before?.recipe.revision ?? 0) + 1,
            );
          const recovered = mutateRecipe(f.context, command, requestId);
          const final = aggregate(f, recovered.entityId);
          expect(final.recipe.revision).toBe((before?.recipe.revision ?? 0) + 1);
          expect(final.ingredients).toHaveLength(1);
          expect(final.steps).toHaveLength(1);
          expect(final.recipeTags).toHaveLength(1);
          expect(
            readRecipeOperations(f.store).filter((entry) => entry.requestId === requestId),
          ).toHaveLength(1);
          const count = f.count();
          expect(mutateRecipe(f.context, command, requestId).outcome).toBe('replayed');
          expect(f.count()).toBe(count);
        }
    });
  }

  it('blocks conflicting writes to a pending recipe while serving its previous complete version', () => {
    const f = setup();
    const created = mutateRecipe(f.context, f.create, randomUUID());
    const before = aggregate(f, created.entityId);
    const update: RecipeMutation = {
      action: 'recipes.updateContent',
      payload: { recipeId: created.entityId, expectedRevision: 1, value: f.value },
    };
    const operationId = randomUUID();
    f.fail(5);
    expect(() => mutateRecipe(f.context, update, operationId)).toThrow();
    f.fail();
    expect(readRecipeAggregate(f.model(), created.entityId)).toEqual(before);
    expect(() => mutateRecipe(f.context, update, randomUUID())).toThrow('RECIPE_PENDING');
    expect(listRecipeOperations(f.context).operations).toMatchObject([
      { operationId, canResume: false },
    ]);
    expect(() => resumeRecipeOperation(f.context, operationId)).toThrow('RECIPE_PENDING');
    expect(cancelRecipeOperation(f.context, operationId).outcome).toBe('cancelled');
    expect(cancelRecipeOperation(f.context, operationId).outcome).toBe('cancelled');
    expect(() => mutateRecipe(f.context, update, operationId)).toThrow('RECIPE_CANCELLED');
    expect(aggregate(f, created.entityId)).toEqual(before);
    expect(mutateRecipe(f.context, update, randomUUID()).revision).toBe(2);
  });

  it('resumes a complete unpublished snapshot without the original request body', () => {
    const f = setup(),
      operationId = randomUUID();
    f.fail(11);
    expect(() => mutateRecipe(f.context, f.create, operationId)).toThrow();
    f.fail();
    expect(listRecipeOperations(f.context).operations).toMatchObject([
      { operationId, canResume: true },
    ]);
    expect(listRecipeSummaries(f.model())).toEqual([]);
    const saved = resumeRecipeOperation(f.context, operationId);
    expect(aggregate(f, saved.entityId).recipe.title).toBe('Новый суп');
    expect(resumeRecipeOperation(f.context, operationId).outcome).toBe('replayed');
    expect(() => cancelRecipeOperation(f.context, operationId)).toThrow('RECIPE_CONFLICT');
  });

  it('rechecks active membership and current role before retry, resume and cancel', () => {
    const f = setup(),
      operationId = randomUUID();
    f.fail(11);
    expect(() => mutateRecipe(f.context, f.create, operationId)).toThrow();
    f.fail();
    const member = f.required('WorkspaceMembers').find((row) => row[1] === other);
    if (!member) throw new Error('fixture');
    member[2] = 'viewer';
    for (const call of [
      () => mutateRecipe(f.context, f.create, operationId),
      () => resumeRecipeOperation(f.context, operationId),
      () => cancelRecipeOperation(f.context, operationId),
    ])
      expect(call).toThrow('ACCESS_DENIED');
    f.context.session.user.id = 'owner-sub';
    expect(resumeRecipeOperation(f.context, operationId).outcome).toBe('committed');
    member[3] = 'disabled';
    f.context.session.user.id = 'author-sub';
    expect(() => mutateRecipe(f.context, f.create, operationId)).toThrow('ACCESS_DENIED');
  });

  it('rejects another actor’s receipts and stale revisions', () => {
    const f = setup(),
      requestId = randomUUID();
    const saved = mutateRecipe(f.context, f.create, requestId);
    f.context.session.user.id = 'owner-sub';
    expect(() => mutateRecipe(f.context, f.create, requestId)).toThrow('OPERATION_MISMATCH');
    f.context.session.user.id = 'author-sub';
    mutateRecipe(
      f.context,
      { action: 'recipes.archive', payload: { recipeId: saved.entityId, expectedRevision: 1 } },
      randomUUID(),
    );
    expect(() =>
      mutateRecipe(
        f.context,
        { action: 'recipes.restore', payload: { recipeId: saved.entityId, expectedRevision: 1 } },
        randomUUID(),
      ),
    ).toThrow('RECIPE_CONFLICT');
    expect(() => resumeRecipeOperation(f.context, randomUUID())).toThrow('ACCESS_DENIED');
  });

  it('stores literal formula-like text and does not leak shared notes', () => {
    const f = setup();
    f.value.content.title = '=IMPORTXML("secret")';
    f.value.content.notes = '\u0000\n+private-note';
    const saved = mutateRecipe(
      f.context,
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
    );
    expect(aggregate(f, saved.entityId).recipe.title).toBe(f.value.content.title);
    expect(
      f
        .required('Recipes')
        .slice(1)
        .flat()
        .every((value) => !/^[=+\-@]/.test(value)),
    ).toBe(true);
    f.context.session.user.id = 'viewer-sub';
    expect(readRecipeAggregate(f.model(), saved.entityId).recipe.notes).toBe('');
    expect(JSON.stringify(listRecipeSummaries(f.model()))).not.toContain('private-note');
    expect(() => mutateRecipe(f.context, f.create, randomUUID())).toThrow('ACCESS_DENIED');
  });

  it('detects modified snapshot cells and corrupt receipts before publication', () => {
    const f = setup(),
      requestId = randomUUID();
    f.fail(11);
    expect(() => mutateRecipe(f.context, f.create, requestId)).toThrow();
    f.fail();
    const row = f.required('Recipes')[1];
    if (!row) throw new Error('fixture');
    row[4] = JSON.stringify('tampered');
    expect(() => resumeRecipeOperation(f.context, requestId)).toThrow('RECIPE_UNAVAILABLE');
    expect(listRecipeSummaries(f.model())).toEqual([]);
    expect(listRecipeOperations(f.context).operations[0]?.canResume).toBe(false);
    expect(cancelRecipeOperation(f.context, requestId).outcome).toBe('cancelled');
  });

  it('leaves a hash-linked audit receipt without recipe contents or credentials', () => {
    const f = setup();
    const saved = mutateRecipe(f.context, f.create, randomUUID());
    const op = readRecipeOperations(f.store).find((entry) => entry.requestId === saved.operationId);
    expect(op).toMatchObject({
      action: 'recipes.create',
      userId: other,
      revision: 1,
      baseRevision: 0,
    });
    expect(JSON.stringify(op)).not.toContain(f.value.content.notes);
    expect(op?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(canonicalRecipeJson({ a: 1, b: 2 }))).toBe(
      sha256(canonicalRecipeJson({ b: 2, a: 1 })),
    );
    expect(owner).not.toBe(other);
  });

  it('versions cover, gallery and step photo links and compacts order after deletion', () => {
    const f = setup();
    let receipt = mutateRecipe(f.context, f.create, randomUUID());
    const photo = (kind: 'cover' | 'gallery' | 'step', position: number) => {
      const id = randomUUID();
      const current = aggregate(f, receipt.entityId);
      const target =
        kind === 'step'
          ? { kind, stepId: current.steps[0]?.id ?? '', position }
          : kind === 'cover'
            ? { kind, position: 0 as const }
            : { kind, position };
      receipt = mutateRecipe(
        f.context,
        {
          action: 'recipes.photos.add',
          payload: {
            recipeId: receipt.entityId,
            expectedRevision: current.recipe.revision,
            photo: {
              uploadId: id,
              imageBase64: 'AAAA',
              thumbnailBase64: 'AQEB',
              width: 1,
              height: 1,
              imageBytes: 3,
              thumbnailBytes: 3,
            },
            target,
          },
        },
        id,
      );
      return id;
    };
    photo('cover', 0);
    const first = photo('gallery', 0);
    photo('gallery', 1);
    photo('step', 0);
    let current = aggregate(f, receipt.entityId);
    expect(current.photos.map(({ kind, position }) => ({ kind, position }))).toEqual([
      { kind: 'cover', position: 0 },
      { kind: 'gallery', position: 0 },
      { kind: 'gallery', position: 1 },
      { kind: 'step', position: 0 },
    ]);
    receipt = mutateRecipe(
      f.context,
      {
        action: 'recipes.photos.delete',
        payload: {
          recipeId: receipt.entityId,
          expectedRevision: current.recipe.revision,
          photoId: first,
        },
      },
      randomUUID(),
    );
    current = aggregate(f, receipt.entityId);
    expect(
      current.photos.filter((item) => item.kind === 'gallery').map((item) => item.position),
    ).toEqual([0]);
    expect(recipeRows(f.store, 'RecipePhotos')).toHaveLength(13);
  });
});
