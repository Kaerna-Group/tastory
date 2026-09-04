import { recipeSchema, tagSchema, recipeAggregateSchema } from '@tastory/contracts';
import type { RecipeAggregate, Recipe, Tag } from '@tastory/contracts';
import type { RecipeModelReader } from './recipe-model';
import {
  readRecipeOperations,
  recipeRows,
  dataTables,
  countFields,
  emptyRecipeSnapshot,
  canonicalRecipeSnapshotJson,
  readRecipeFavorites,
  RecipeStorageError,
} from './recipe-storage';
import type { RecipeStore, RecipeOperation, RecipeSnapshot } from './recipe-storage';
import type { RecipeDataTable } from '../schema/recipe-schema';

// Construct a new reader under ScriptLock on every request. Only committed snapshots are visible.
export function createRecipeReader(
  store: RecipeStore,
  sha256: (text: string) => string,
): RecipeModelReader {
  const operations = readRecipeOperations(store).filter((op) => op.state.startsWith('committed@'));
  const favorites = readRecipeFavorites(store);
  const latest = new Map<string, RecipeOperation>();
  for (const op of operations) latest.set(`${op.entityType}:${op.entityId}`, op);
  const groups = new Map<RecipeDataTable, Map<string, Record<string, unknown>[]>>();
  const snapshots = new Map<string, RecipeSnapshot>();
  const snapshot = (op: RecipeOperation) => {
    const cached = snapshots.get(op.requestId);
    if (cached) return cached;
    const result = emptyRecipeSnapshot();
    for (const table of dataTables) {
      let grouped = groups.get(table);
      if (!grouped) {
        grouped = new Map();
        for (const row of recipeRows(store, table)) {
          const { versionId, ...record } = row;
          if (typeof versionId !== 'string') throw new RecipeStorageError();
          const entries = grouped.get(versionId) ?? [];
          entries.push(record);
          grouped.set(versionId, entries);
        }
        groups.set(table, grouped);
      }
      result[table] = grouped.get(op.requestId) ?? [];
      const countField = countFields[table as keyof typeof countFields];
      if (countField && result[table].length !== op[countField]) throw new RecipeStorageError();
    }
    if (sha256(canonicalRecipeSnapshotJson(result)) !== op.snapshotHash)
      throw new RecipeStorageError();
    snapshots.set(op.requestId, result);
    return result;
  };
  const getRecipe = (id: string): Recipe | null => {
    const op = latest.get(`recipe:${id}`);
    if (!op) return null;
    const parsed = recipeSchema.safeParse(snapshot(op).Recipes[0]);
    if (
      !parsed.success ||
      parsed.data.id !== id ||
      parsed.data.workspaceId !== op.workspaceId ||
      parsed.data.revision !== op.revision
    )
      throw new RecipeStorageError();
    return parsed.data;
  };
  const getTag = (id: string): Tag | null => {
    const op = latest.get(`tag:${id}`);
    if (!op) return null;
    const parsed = tagSchema.safeParse(snapshot(op).Tags[0]);
    if (
      !parsed.success ||
      parsed.data.id !== id ||
      parsed.data.workspaceId !== op.workspaceId ||
      parsed.data.revision !== op.revision
    )
      throw new RecipeStorageError();
    return parsed.data;
  };
  const getAggregate = (id: string): RecipeAggregate | null => {
    const op = latest.get(`recipe:${id}`);
    const recipe = getRecipe(id);
    if (!op || !recipe) return null;
    const rows = snapshot(op);
    const tags = rows.RecipeTags.map((link) =>
      typeof link.tagId === 'string' ? getTag(link.tagId) : null,
    );
    const parsed = recipeAggregateSchema.safeParse({
      recipe,
      ingredients: rows.RecipeIngredients,
      steps: rows.RecipeSteps,
      photos: rows.RecipePhotos,
      recipeTags: rows.RecipeTags,
      tags,
    });
    if (!parsed.success) throw new RecipeStorageError();
    return parsed.data;
  };
  const findChild = (id: string, field: 'ingredients' | 'steps') => {
    let found: unknown = null;
    for (const op of latest.values()) {
      if (op.entityType !== 'recipe') continue;
      const match = getAggregate(op.entityId)?.[field].find((child) => child.id === id);
      if (match) {
        if (found) throw new RecipeStorageError();
        found = match;
      }
    }
    return found;
  };
  return {
    getRecipe,
    getTag,
    getAggregate,
    getIngredient: (id) => findChild(id, 'ingredients'),
    getStep: (id) => findChild(id, 'steps'),
    getRecipeTag: (recipeId, tagId) =>
      getAggregate(recipeId)?.recipeTags.find((link) => link.tagId === tagId) ?? null,
    listRecipes: (workspaceId) =>
      [...latest.values()]
        .filter((op) => op.workspaceId === workspaceId && op.entityType === 'recipe')
        .map((op) => getRecipe(op.entityId)),
    listTags: (workspaceId) =>
      [...latest.values()]
        .filter((op) => op.workspaceId === workspaceId && op.entityType === 'tag')
        .map((op) => getTag(op.entityId)),
    isRecipeFavorite: (workspaceId, userId, recipeId) => {
      let favorite = false;
      for (const entry of favorites)
        if (
          entry.workspaceId === workspaceId &&
          entry.userId === userId &&
          entry.recipeId === recipeId
        )
          favorite = entry.isFavorite;
      return favorite;
    },
  };
}
