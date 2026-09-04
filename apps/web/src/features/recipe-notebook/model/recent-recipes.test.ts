import { describe, expect, it } from 'vitest';
import { recipeAggregateSchema } from '@tastory/contracts';
import type { RecipeAggregate, RecipeSummary } from '@tastory/contracts';
import {
  cacheRecentLibrary,
  cacheRecentRecipe,
  readRecentLibrary,
  readRecentRecipe,
} from './recent-recipes';

class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const summary = (id: string): RecipeSummary => ({
  id,
  workspaceId: '22222222-2222-4222-8222-222222222222',
  ownerUserId: '33333333-3333-4333-8333-333333333333',
  title: 'Суп',
  description: '',
  servings: 2,
  prepMinutes: 5,
  cookMinutes: 20,
  visibility: 'private',
  status: 'published',
  ingredientNames: ['Томаты'],
  tags: [],
  coverPhotoId: null,
  favorite: false,
  revision: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
});

const aggregate = (id: string): RecipeAggregate =>
  recipeAggregateSchema.parse({
    recipe: {
      id,
      workspaceId: '22222222-2222-4222-8222-222222222222',
      ownerUserId: '33333333-3333-4333-8333-333333333333',
      title: 'Суп',
      description: '',
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 20,
      sourceUrl: '',
      notes: '',
      visibility: 'private',
      status: 'published',
      revision: 1,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-03T10:00:00.000Z',
      deletedAt: null,
    },
    ingredients: [],
    steps: [],
    photos: [],
    tags: [],
    recipeTags: [],
  });

describe('recent recipe cache', () => {
  it('keeps account scopes separate and returns validated library data', () => {
    const storage = new MemoryStorage();
    const id = '11111111-1111-4111-8111-111111111111';
    cacheRecentLibrary(storage, 'account-a', [summary(id)]);
    expect(readRecentLibrary(storage, 'account-a')).toHaveLength(1);
    expect(readRecentLibrary(storage, 'account-b')).toEqual([]);
  });

  it('keeps opened aggregate for read-only offline recovery', () => {
    const storage = new MemoryStorage();
    const id = '11111111-1111-4111-8111-111111111111';
    cacheRecentRecipe(storage, 'account-a', aggregate(id));
    expect(readRecentRecipe(storage, 'account-a', id)?.recipe.title).toBe('Суп');
  });

  it('ignores damaged cache values', () => {
    const storage = new MemoryStorage();
    storage.setItem('tastory.recent-recipes.v1:account-a', '{broken');
    expect(readRecentLibrary(storage, 'account-a')).toEqual([]);
  });
});
