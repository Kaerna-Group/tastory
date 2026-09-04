import { recipeAggregateSchema, recipeSummarySchema } from '@tastory/contracts';
import type { RecipeAggregate, RecipeSummary } from '@tastory/contracts';
import type { DraftStorage } from './drafts';

const PREFIX = 'tastory.recent-recipes.v1:';
const MAX_LIBRARY_RECIPES = 50;
const MAX_OPENED_RECIPES = 12;
const MAX_BYTES = 2 * 1024 * 1024;

interface RecentRecipe {
  openedAt: string;
  aggregate: RecipeAggregate;
}

interface RecentBook {
  version: 1;
  scope: string;
  savedAt: string;
  library: RecipeSummary[];
  opened: RecentRecipe[];
}

const keyFor = (scope: string) => `${PREFIX}${encodeURIComponent(scope)}`;
const emptyBook = (scope: string): RecentBook => ({
  version: 1,
  scope,
  savedAt: new Date(0).toISOString(),
  library: [],
  opened: [],
});

function readBook(storage: DraftStorage, scope: string): RecentBook {
  try {
    const raw = storage.getItem(keyFor(scope));
    if (!raw || raw.length > MAX_BYTES) return emptyBook(scope);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyBook(scope);
    const value = parsed as Record<string, unknown>;
    if (value['version'] !== 1 || value['scope'] !== scope || typeof value['savedAt'] !== 'string')
      return emptyBook(scope);
    const library = recipeSummarySchema.array().max(MAX_LIBRARY_RECIPES).parse(value['library']);
    if (!Array.isArray(value['opened']) || value['opened'].length > MAX_OPENED_RECIPES)
      return emptyBook(scope);
    const opened = value['opened'].map((item): RecentRecipe => {
      if (!item || typeof item !== 'object') throw new Error('Invalid recent recipe.');
      const record = item as Record<string, unknown>;
      if (
        typeof record['openedAt'] !== 'string' ||
        !Number.isFinite(Date.parse(record['openedAt']))
      )
        throw new Error('Invalid recent recipe date.');
      return {
        openedAt: record['openedAt'],
        aggregate: recipeAggregateSchema.parse(record['aggregate']),
      };
    });
    return { version: 1, scope, savedAt: value['savedAt'], library, opened };
  } catch {
    return emptyBook(scope);
  }
}

function writeBook(storage: DraftStorage, book: RecentBook): void {
  storage.setItem(keyFor(book.scope), JSON.stringify(book));
}

export function cacheRecentLibrary(
  storage: DraftStorage,
  scope: string,
  recipes: RecipeSummary[],
): void {
  const book = readBook(storage, scope);
  writeBook(storage, {
    ...book,
    savedAt: new Date().toISOString(),
    library: recipeSummarySchema
      .array()
      .max(10_000)
      .parse(recipes)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_LIBRARY_RECIPES),
  });
}

export function readRecentLibrary(storage: DraftStorage, scope: string): RecipeSummary[] {
  return readBook(storage, scope).library;
}

export function cacheRecentRecipe(
  storage: DraftStorage,
  scope: string,
  aggregate: RecipeAggregate,
): void {
  const book = readBook(storage, scope);
  const parsed = recipeAggregateSchema.parse(aggregate);
  writeBook(storage, {
    ...book,
    savedAt: new Date().toISOString(),
    opened: [
      { openedAt: new Date().toISOString(), aggregate: parsed },
      ...book.opened.filter((item) => item.aggregate.recipe.id !== parsed.recipe.id),
    ].slice(0, MAX_OPENED_RECIPES),
  });
}

export function readRecentRecipe(
  storage: DraftStorage,
  scope: string,
  recipeId: string,
): RecipeAggregate | null {
  return (
    readBook(storage, scope).opened.find((item) => item.aggregate.recipe.id === recipeId)
      ?.aggregate ?? null
  );
}
