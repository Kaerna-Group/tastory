import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backupFixture, present } from '../test-support/backup-fixture';
import { mutateRecipe, cancelRecipeOperation } from './recipe-mutations';
import { archiveRecipeHistory, readRecipeVersion, recipeHistory } from './recipe-history';
import { readRecipeOperations, recipeRows } from './recipe-storage';
import { sha256 } from '../test-support/journal-fixture';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('expands the physical Sheets grid before appending recipe rows', () => {
  const f = backupFixture();
  const original = f.book.getSheetByName.bind(f.book);
  const dimensions = new Map<string, number>();
  const expanded: string[] = [];
  vi.spyOn(f.book, 'getSheetByName').mockImplementation((name) => {
    const sheet = original(name);
    if (!sheet || (!name.startsWith('Recipe') && name !== 'Tags')) return sheet;
    return {
      ...sheet,
      getMaxRows: () => dimensions.get(name) ?? 1,
      insertRowsAfter: (row: number, count: number) => {
        expect(row).toBe(dimensions.get(name) ?? 1);
        dimensions.set(name, row + count);
        expanded.push(name);
      },
      getRange: (row: number, column: number, height: number, width: number) => {
        if (row + height - 1 > (dimensions.get(name) ?? 1))
          throw new Error('Range exceeds physical grid');
        return sheet.getRange(row, column, height, width);
      },
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
  });
  expect(
    mutateRecipe(
      f.context,
      { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
      randomUUID(),
    ).outcome,
  ).toBe('committed');
  expect(expanded).toEqual(
    expect.arrayContaining(['RecipeOperations', 'Recipes', 'RecipeIngredients', 'RecipeSteps']),
  );
});
function scenario() {
  const f = backupFixture(),
    requestId = randomUUID();
  const command = {
    action: 'recipes.create' as const,
    payload: { value: f.value, visibility: 'workspace' as const },
  };
  const saved = mutateRecipe(f.context, command, requestId);
  mutateRecipe(
    f.context,
    {
      action: 'recipes.updateContent',
      payload: {
        recipeId: saved.entityId,
        expectedRevision: 1,
        value: { ...f.value, content: { ...f.value.content, title: 'Версия два' } },
      },
    },
    randomUUID(),
  );
  f.fail();
  f.failDrive();
  const archive = () => archiveRecipeHistory(f.store, sha256, () => {});
  return { ...f, command, requestId, saved, archiveHistory: archive };
}
it('archives full history and permanent receipts while reads, new writes and old retries remain correct', () => {
  const f = scenario();
  expect(f.archiveHistory()).toEqual({ archived: 1, totalArchived: 1, active: 1 });
  f.store.archive = f.archive();
  expect(readRecipeVersion(f.context, f.saved.entityId, 1).recipe.title).toBe('Новый суп');
  expect(recipeRows(f.store, 'Recipes')).toHaveLength(1);
  expect(mutateRecipe(f.context, f.command, f.requestId).outcome).toBe('replayed');
  expect(() =>
    mutateRecipe(
      f.context,
      {
        ...f.command,
        payload: {
          ...f.command.payload,
          value: { ...f.value, content: { ...f.value.content, title: 'Подмена' } },
        },
      },
      f.requestId,
    ),
  ).toThrow('OPERATION_MISMATCH');
  const archived = mutateRecipe(
    f.context,
    { action: 'recipes.archive', payload: { recipeId: f.saved.entityId, expectedRevision: 2 } },
    randomUUID(),
  );
  expect(archived.revision).toBe(3);
  f.archiveHistory();
  expect(mutateRecipe(f.context, f.command, f.requestId).revision).toBe(1);
  expect(readRecipeOperations(f.store)).toHaveLength(3);
  expect(
    recipeHistory(f.context, f.saved.entityId).versions.map((entry) => entry.revision),
  ).toEqual([3, 2, 1]);
  f.context.session.user.id = 'viewer-sub';
  expect(readRecipeVersion(f.context, f.saved.entityId, 1).recipe.notes).toBe('');
  f.context.session.expiresAt = f.context.now().toISOString();
  expect(() => recipeHistory(f.context, f.saved.entityId)).toThrow('UNAUTHENTICATED');
});
it('never discloses private history to another member', () => {
  const f = backupFixture();
  const saved = mutateRecipe(
    f.context,
    { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
    randomUUID(),
  );
  f.context.session.user.id = 'viewer-sub';
  expect(() => recipeHistory(f.context, saved.entityId)).toThrow('ACCESS_DENIED');
  expect(() => readRecipeVersion(f.context, saved.entityId, 1)).toThrow('ACCESS_DENIED');
});
it('restores an archived snapshot as a new revision without deleting later history', () => {
  const f = scenario();
  f.archiveHistory();
  f.store.archive = f.archive();
  const requestId = randomUUID();
  const command = {
    action: 'recipes.version.restore' as const,
    payload: {
      recipeId: f.saved.entityId,
      expectedRevision: 2,
      targetRevision: 1,
    },
  };
  expect(mutateRecipe(f.context, command, requestId)).toMatchObject({
    revision: 3,
    outcome: 'committed',
  });
  expect(f.reader().getAggregate(f.saved.entityId)).toMatchObject({
    recipe: { title: 'Новый суп', revision: 3, status: 'draft' },
  });
  expect(readRecipeVersion(f.context, f.saved.entityId, 2).recipe.title).toBe('Версия два');
  expect(recipeHistory(f.context, f.saved.entityId).versions).toMatchObject([
    { revision: 3, action: 'recipes.version.restore' },
    { revision: 2 },
    { revision: 1 },
  ]);
  expect(mutateRecipe(f.context, command, requestId).outcome).toBe('replayed');
  expect(() =>
    mutateRecipe(
      f.context,
      { ...command, payload: { ...command.payload, targetRevision: 2 } },
      requestId,
    ),
  ).toThrow('OPERATION_MISMATCH');
  expect(() =>
    mutateRecipe(
      f.context,
      { ...command, payload: { ...command.payload, expectedRevision: 2 } },
      randomUUID(),
    ),
  ).toThrow('RECIPE_CONFLICT');
  f.context.session.user.id = 'viewer-sub';
  expect(() =>
    mutateRecipe(
      f.context,
      { ...command, payload: { ...command.payload, expectedRevision: 3 } },
      randomUUID(),
    ),
  ).toThrow('ACCESS_DENIED');
});
for (const backend of ['sheets', 'drive'] as const)
  it(`resumes archival before/after every ${backend} mutation without losing history or replay protection`, () => {
    const measured = scenario();
    measured.archiveHistory();
    const boundaries = backend === 'sheets' ? measured.count() : measured.driveWrites();
    expect(boundaries).toBeGreaterThan(2);
    for (const after of [false, true])
      for (let index = 1; index <= boundaries; index++) {
        const f = scenario();
        if (backend === 'sheets') f.fail(index, after);
        else f.failDrive(index, after);
        expect(() => f.archiveHistory()).toThrow();
        f.fail();
        f.failDrive();
        f.store.archive = f.archive();
        expect(mutateRecipe(f.context, f.command, f.requestId).outcome).toBe('replayed');
        f.archiveHistory();
        expect(readRecipeVersion(f.context, f.saved.entityId, 1).recipe.title).toBe('Новый суп');
        expect(recipeRows(f.store, 'RecipeOperations')).toHaveLength(1);
        expect(readRecipeOperations(f.store)).toHaveLength(2);
      }
  });
it('retains cancelled request tombstones and never archives a started operation', () => {
  const f = scenario(),
    requestId = randomUUID();
  f.fail(3);
  expect(() => mutateRecipe(f.context, f.command, requestId)).toThrow();
  f.fail();
  f.archiveHistory();
  expect(readRecipeOperations(f.store).find((op) => op.requestId === requestId)?.state).toBe(
    'started',
  );
  cancelRecipeOperation(f.context, requestId);
  f.archiveHistory();
  expect(() => mutateRecipe(f.context, f.command, requestId)).toThrow('RECIPE_CANCELLED');
  expect(cancelRecipeOperation(f.context, requestId).outcome).toBe('cancelled');
});
it('fails closed for missing, public or damaged archive files', () => {
  for (const damage of ['missing', 'public', 'content']) {
    const f = scenario();
    f.archiveHistory();
    const file = present(
      [...f.files.values()].find((file) => file.name.startsWith('tastory-history-')),
    );
    if (damage === 'missing') f.files.delete(file.id);
    if (damage === 'public') file.privateAccess = false;
    if (damage === 'content') file.content += 'damage';
    f.store.archive = f.archive();
    expect(() => readRecipeVersion(f.context, f.saved.entityId, 1)).toThrow();
  }
});
it('writes a large recipe in resumable bounded batches', () => {
  const f = backupFixture(),
    requestId = randomUUID();
  f.value.steps = Array.from({ length: 100 }, (_, position) => ({
    ...present(f.value.steps[0]),
    position,
    body: 'Текст '.repeat(1000),
  }));
  const write = f.store.writeRows;
  let batches = 0;
  f.store.writeRows = (table, row, values) => {
    if (table === 'RecipeSteps') {
      expect(values.length).toBeLessThanOrEqual(25);
      batches++;
    }
    write(table, row, values);
    if (table === 'RecipeSteps' && batches === 2) throw new Error('interrupted batch');
  };
  const command = {
    action: 'recipes.create' as const,
    payload: { value: f.value, visibility: 'private' as const },
  };
  expect(() => mutateRecipe(f.context, command, requestId)).toThrow('interrupted batch');
  expect(f.reader().listRecipes(f.context.workspaceId)).toEqual([]);
  const saved = mutateRecipe(f.context, command, requestId);
  expect(readRecipeVersion(f.context, saved.entityId, 1).steps).toHaveLength(100);
  expect(recipeRows(f.store, 'RecipeSteps')).toHaveLength(100);
});
