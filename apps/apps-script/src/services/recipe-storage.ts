import { z } from 'zod';
import { recipeMutationActions } from '@tastory/contracts';
import { RECIPE_TABLES, RECIPE_OPERATION_LIMIT, RECIPE_ROW_LIMIT } from '../schema/recipe-schema';
import type { RecipeTableName, RecipeDataTable } from '../schema/recipe-schema';
import type { TableSnapshot } from './core-migration';
import type { JournalStore } from './journal-migration';

export class RecipeStorageError extends Error {
  constructor(
    public readonly code:
      | 'RECIPE_NOT_READY'
      | 'RECIPE_UNAVAILABLE'
      | 'RECIPE_CONFLICT'
      | 'RECIPE_PENDING'
      | 'RECIPE_LIMIT'
      | 'RECIPE_CANCELLED'
      | 'OPERATION_MISMATCH' = 'RECIPE_UNAVAILABLE',
  ) {
    super(code);
  }
}
export type RecipeStore = {
  archive?: RecipeArchiveStore;
  deleteRows?: (table: RecipeTableName, firstRow: number, count: number) => void;
  journal: JournalStore;
  read: (table: RecipeTableName) => TableSnapshot | null;
  create: (table: RecipeTableName) => void;
  writeRows: (
    table: RecipeTableName,
    firstRow: number,
    rows: readonly (readonly string[])[],
  ) => void;
  writeState: (row: number, state: string) => void;
  flush: () => void;
};
export type RecipeSnapshot = Record<RecipeDataTable, Record<string, unknown>[]>;
export const emptyRecipeSnapshot = (): RecipeSnapshot => ({
  Recipes: [],
  RecipeIngredients: [],
  RecipeSteps: [],
  RecipePhotos: [],
  Tags: [],
  RecipeTags: [],
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const terminalState = z.string().refine((state) => {
  const [status, ...date] = state.split('@');
  return (
    (status === 'committed' || status === 'cancelled') &&
    z.iso.datetime().safeParse(date.join('@')).success
  );
});
export const recipeOperationSchema = z
  .strictObject({
    requestId: z.uuid(),
    workspaceId: z.uuid(),
    userId: z.uuid(),
    action: z.enum(recipeMutationActions),
    entityType: z.enum(['recipe', 'tag']),
    entityId: z.uuid(),
    baseRevision: revision,
    revision: revision,
    payloadHash: hash,
    beforeHash: hash,
    snapshotHash: hash,
    recipeCount: z.number().int().min(0).max(1),
    ingredientCount: z.number().int().min(0).max(200),
    stepCount: z.number().int().min(0).max(100),
    tagCount: z.number().int().min(0).max(1),
    linkCount: z.number().int().min(0).max(30),
    startedAt: z.iso.datetime(),
    state: z.union([z.literal('started'), terminalState]),
  })
  .refine(
    (op) =>
      op.revision === op.baseRevision + 1 &&
      (op.state === 'started' ||
        Date.parse(op.state.split('@')[1] ?? '') >= Date.parse(op.startedAt)) &&
      (op.action === 'tags.create'
        ? op.entityType === 'tag' &&
          op.baseRevision === 0 &&
          op.tagCount === 1 &&
          op.recipeCount + op.ingredientCount + op.stepCount + op.linkCount === 0
        : op.entityType === 'recipe' &&
          op.recipeCount === 1 &&
          op.tagCount === 0 &&
          (op.action === 'recipes.create' ? op.baseRevision === 0 : op.baseRevision > 0)),
  );
export type RecipeOperation = z.infer<typeof recipeOperationSchema>;
export type RecipeArchiveStore = {
  operations: () => RecipeOperation[];
  snapshot: (requestId: string) => RecipeSnapshot | null;
  publish: (entries: { operation: RecipeOperation; snapshot: RecipeSnapshot }[]) => void;
};
export const recipeFavoriteSchema = z.strictObject({
  requestId: z.uuid(),
  workspaceId: z.uuid(),
  userId: z.uuid(),
  recipeId: z.uuid(),
  isFavorite: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type RecipeFavorite = z.infer<typeof recipeFavoriteSchema>;
export const dataTables: RecipeDataTable[] = [
  'Recipes',
  'RecipeIngredients',
  'RecipeSteps',
  'RecipePhotos',
  'Tags',
  'RecipeTags',
];
export const countFields = {
  Recipes: 'recipeCount',
  RecipeIngredients: 'ingredientCount',
  RecipeSteps: 'stepCount',
  Tags: 'tagCount',
  RecipeTags: 'linkCount',
} as const;
export function canonicalRecipeJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return item;
  };
  return JSON.stringify(sort(value));
}
// Schema v3 snapshots did not contain RecipePhotos. Keep their exact hash shape
// whenever the photo list is empty so archived history and hash chains stay valid.
export function canonicalRecipeSnapshotJson(snapshot: RecipeSnapshot): string {
  if (snapshot.RecipePhotos.length) return canonicalRecipeJson(snapshot);
  const { RecipePhotos, ...legacy } = snapshot;
  void RecipePhotos;
  return canonicalRecipeJson(legacy);
}
const camel = (column: string) =>
  column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
export function encodeRecipeRow(table: RecipeTableName, record: Record<string, unknown>): string[] {
  const definition = RECIPE_TABLES.find((item) => item.name === table);
  if (!definition) throw new RecipeStorageError();
  return definition.columns.map((column) => {
    const value = record[camel(column)];
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      throw new RecipeStorageError();
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded.length > 20002)
      throw new RecipeStorageError('RECIPE_LIMIT');
    return encoded;
  });
}
export function recipeRows(store: RecipeStore, table: RecipeTableName): Record<string, unknown>[] {
  const snapshot = store.read(table);
  const definition = RECIPE_TABLES.find((item) => item.name === table);
  if (
    !snapshot ||
    !definition ||
    snapshot.columnCount !== definition.columns.length ||
    definition.columns.some((column, i) => snapshot.headers[i] !== column)
  )
    throw new RecipeStorageError();
  const limit = table === 'RecipeOperations' ? RECIPE_OPERATION_LIMIT : RECIPE_ROW_LIMIT;
  if (snapshot.rows.length > limit) throw new RecipeStorageError('RECIPE_LIMIT');
  try {
    return snapshot.rows.map((row) => {
      if (row.length !== definition.columns.length) throw new RecipeStorageError();
      return Object.fromEntries(
        definition.columns.map((column, i) => {
          const value: unknown = JSON.parse(row[i] ?? '');
          if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
            throw new RecipeStorageError();
          return [camel(column), value];
        }),
      );
    });
  } catch {
    throw new RecipeStorageError();
  }
}
export function readRecipeOperations(store: RecipeStore): RecipeOperation[] {
  const parsed = z.array(recipeOperationSchema).safeParse(recipeRows(store, 'RecipeOperations'));
  if (!parsed.success) throw new RecipeStorageError();
  if (new Set(parsed.data.map((op) => op.requestId)).size !== parsed.data.length)
    throw new RecipeStorageError();
  const merged = new Map<string, RecipeOperation>();
  const archived = z.array(recipeOperationSchema).parse(store.archive?.operations() ?? []);
  for (const op of [...archived, ...parsed.data]) {
    const previous = merged.get(op.requestId);
    if (previous && canonicalRecipeJson(previous) !== canonicalRecipeJson(op))
      throw new RecipeStorageError();
    merged.set(op.requestId, op);
  }
  const operations = [...merged.values()].sort((a, b) => a.revision - b.revision);
  const revisions = new Map<string, number>();
  const hashes = new Map<string, string>();
  for (const op of operations) {
    if (!op.state.startsWith('committed@')) continue;
    const key = `${op.workspaceId}:${op.entityType}:${op.entityId}`;
    if ((revisions.get(key) ?? 0) !== op.baseRevision) throw new RecipeStorageError();
    if (hashes.has(key) && hashes.get(key) !== op.beforeHash) throw new RecipeStorageError();
    revisions.set(key, op.revision);
    hashes.set(key, op.snapshotHash);
  }
  return operations;
}
export function readRecipeFavorites(store: RecipeStore): RecipeFavorite[] {
  const parsed = z.array(recipeFavoriteSchema).safeParse(recipeRows(store, 'RecipeFavorites'));
  if (!parsed.success) throw new RecipeStorageError();
  if (new Set(parsed.data.map((entry) => entry.requestId)).size !== parsed.data.length)
    throw new RecipeStorageError();
  return parsed.data;
}
export function snapshotForOperation(store: RecipeStore, op: RecipeOperation): RecipeSnapshot {
  const snapshot = emptyRecipeSnapshot();
  for (const table of dataTables) {
    snapshot[table] = recipeRows(store, table)
      .filter((row) => row.versionId === op.requestId)
      .map((row) => {
        return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'versionId'));
      });
    const countField = countFields[table as keyof typeof countFields];
    if (countField && snapshot[table].length !== op[countField])
      throw new RecipeStorageError('RECIPE_PENDING');
  }
  return snapshot;
}
