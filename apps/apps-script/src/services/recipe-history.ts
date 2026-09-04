import { recipeAggregateSchema, recipeSchema } from '@tastory/contracts';
import type { RecipeAggregate } from '@tastory/contracts';
import type { RecipeStore, RecipeOperation, RecipeSnapshot } from './recipe-storage';
import {
  canonicalRecipeJson,
  canonicalRecipeSnapshotJson,
  dataTables,
  emptyRecipeSnapshot,
  readRecipeOperations,
  recipeRows,
  RecipeStorageError,
  snapshotForOperation,
} from './recipe-storage';
import type { RecipeWriteContext } from './recipe-context';
import { readRecipeAggregate } from './recipe-model';
import { createRecipeReader } from './recipe-reader';

export function historicalSnapshot(
  store: RecipeStore,
  op: RecipeOperation,
  sha256: (value: string) => string,
) {
  const archived = store.archive?.snapshot(op.requestId);
  const snapshot = { ...emptyRecipeSnapshot(), ...(archived ?? snapshotForOperation(store, op)) };
  if (sha256(canonicalRecipeSnapshotJson(snapshot)) !== op.snapshotHash)
    throw new RecipeStorageError();
  return snapshot;
}

// Call under the same lock as writes. Publish immutable history BEFORE deleting any live rows.
export function archiveRecipeHistory(
  store: RecipeStore,
  sha256: (value: string) => string,
  assertLive: () => void,
) {
  if (!store.archive || !store.deleteRows) throw new RecipeStorageError();
  const operations = readRecipeOperations(store);
  const latest = new Map<string, string>();
  for (const op of operations)
    if (op.state.startsWith('committed@'))
      latest.set(`${op.entityType}:${op.entityId}`, op.requestId);
  const activeIds = new Set(recipeRows(store, 'RecipeOperations').map((op) => op.requestId));
  const archived = new Set(store.archive.operations().map((op) => op.requestId));
  const candidates = operations.filter(
    (op) =>
      activeIds.has(op.requestId) &&
      !archived.has(op.requestId) &&
      op.state !== 'started' &&
      latest.get(`${op.entityType}:${op.entityId}`) !== op.requestId,
  );
  const tables = new Map(dataTables.map((table) => [table, recipeRows(store, table)]));
  const entries: { operation: RecipeOperation; snapshot: RecipeSnapshot }[] = [];
  let size = 0;
  for (const op of candidates.slice(0, 100)) {
    const snapshot = emptyRecipeSnapshot();
    for (const table of dataTables)
      snapshot[table] = (tables.get(table) ?? [])
        .filter((row) => row.versionId === op.requestId)
        .map(({ versionId, ...row }) => {
          void versionId;
          return row;
        });
    if (
      op.state.startsWith('committed@') &&
      sha256(canonicalRecipeSnapshotJson(snapshot)) !== op.snapshotHash
    )
      throw new RecipeStorageError();
    const entry = { operation: op, snapshot };
    const length = canonicalRecipeJson(entry).length;
    if (size + length > 4 * 1024 * 1024) break;
    entries.push(entry);
    size += length;
  }
  if (entries.length) {
    assertLive();
    store.archive.publish(entries);
  }
  // Re-read the published archive, including any previous interrupted cleanup.
  const durable = new Map(store.archive.operations().map((op) => [op.requestId, op]));
  // Verify the remaining live rows against the durable payload even after an interrupted cleanup.
  // Never delete a modified row just because its version ID appears in the archive.
  const archivedSnapshots = new Map<string, RecipeSnapshot>();
  for (const [id, op] of durable) {
    if (!activeIds.has(id)) continue;
    const archivedSnapshot = store.archive.snapshot(id);
    const snapshot = archivedSnapshot ? { ...emptyRecipeSnapshot(), ...archivedSnapshot } : null;
    if (
      !snapshot ||
      dataTables.some((table) => !Array.isArray(snapshot[table])) ||
      (op.state.startsWith('committed@') &&
        sha256(canonicalRecipeSnapshotJson(snapshot)) !== op.snapshotHash)
    )
      throw new RecipeStorageError();
    archivedSnapshots.set(id, snapshot);
  }
  for (const table of [...dataTables, 'RecipeOperations'] as const) {
    const rows = recipeRows(store, table);
    if (table !== 'RecipeOperations') {
      const available = new Map<string, number>();
      for (const [id, snapshot] of archivedSnapshots)
        for (const row of snapshot[table]) {
          const key = `${id}:${canonicalRecipeJson(row)}`;
          available.set(key, (available.get(key) ?? 0) + 1);
        }
      for (const { versionId, ...row } of rows) {
        if (!durable.has(String(versionId))) continue;
        const key = `${String(versionId)}:${canonicalRecipeJson(row)}`,
          count = available.get(key) ?? 0;
        if (count < 1) throw new RecipeStorageError();
        available.set(key, count - 1);
      }
    }
    for (let end = rows.length - 1; end >= 0;) {
      const id = String(table === 'RecipeOperations' ? rows[end]?.requestId : rows[end]?.versionId);
      if (!durable.has(id)) {
        end--;
        continue;
      }
      let start = end;
      while (
        start > 0 &&
        durable.has(
          String(
            table === 'RecipeOperations' ? rows[start - 1]?.requestId : rows[start - 1]?.versionId,
          ),
        )
      )
        start--;
      assertLive();
      store.deleteRows(table, start + 2, end - start + 1);
      store.flush();
      end = start - 1;
    }
  }
  readRecipeOperations(store);
  return {
    archived: entries.length,
    totalArchived: durable.size,
    active: recipeRows(store, 'RecipeOperations').length,
  };
}

export function recipeHistory(
  context: RecipeWriteContext,
  recipeId: string,
  beforeRevision?: number,
) {
  readRecipeAggregate(
    { ...context, reader: createRecipeReader(context.store, context.sha256) },
    recipeId,
  );
  const entries = readRecipeOperations(context.store)
    .filter(
      (op) =>
        op.workspaceId === context.workspaceId &&
        op.entityType === 'recipe' &&
        op.entityId === recipeId &&
        op.state.startsWith('committed@') &&
        (!beforeRevision || op.revision < beforeRevision),
    )
    .reverse();
  return {
    kind: 'history' as const,
    recipeId,
    versions: entries.slice(0, 50).map((op) => ({
      revision: op.revision,
      action: op.action,
      completedAt: op.state.split('@')[1] ?? op.startedAt,
    })),
    nextBeforeRevision: entries.length > 50 ? (entries[49]?.revision ?? null) : null,
  };
}

export function readRecipeVersion(
  context: RecipeWriteContext,
  recipeId: string,
  revision: number,
): RecipeAggregate {
  const reader = createRecipeReader(context.store, context.sha256);
  readRecipeAggregate({ ...context, reader }, recipeId);
  const op = readRecipeOperations(context.store).find(
    (entry) =>
      entry.entityType === 'recipe' &&
      entry.entityId === recipeId &&
      entry.workspaceId === context.workspaceId &&
      entry.revision === revision &&
      entry.state.startsWith('committed@'),
  );
  if (!op) throw new RecipeStorageError('RECIPE_CONFLICT');
  const snapshot = historicalSnapshot(context.store, op, context.sha256);
  const recipe = recipeSchema.parse(snapshot.Recipes[0]);
  const aggregate = recipeAggregateSchema.parse({
    recipe,
    ingredients: snapshot.RecipeIngredients,
    steps: snapshot.RecipeSteps,
    photos: snapshot.RecipePhotos,
    recipeTags: snapshot.RecipeTags,
    tags: snapshot.RecipeTags.map((link) => reader.getTag(String(link.tagId))),
  });
  // Reuse object and note authorization for the historical version as well as today's recipe.
  return readRecipeAggregate(
    { ...context, reader: { ...reader, getRecipe: () => recipe, getAggregate: () => aggregate } },
    recipeId,
  );
}
