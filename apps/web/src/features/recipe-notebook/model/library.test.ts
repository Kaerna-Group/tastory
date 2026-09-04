import { describe, expect, it } from 'vitest';
import type { RecipeSummary } from '@tastory/contracts';
import { readLibraryQuery, selectLibraryRecipes, writeLibraryQuery } from './library';

const recipe = (overrides: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: crypto.randomUUID(),
  workspaceId: '55555555-5555-4555-8555-555555555555',
  ownerUserId: '22222222-2222-4222-8222-222222222222',
  title: 'Томатный суп',
  description: '',
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 20,
  visibility: 'private',
  status: 'draft',
  ingredientNames: ['Томаты', 'Базилик'],
  tags: [],
  coverPhotoId: null,
  favorite: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
  revision: 1,
  ...overrides,
});

describe('recipe library query', () => {
  it('round-trips non-default URL state and rejects unknown options', () => {
    const parsed = readLibraryQuery(
      new URLSearchParams(
        'q=суп&status=archived&visibility=workspace&favorite=1&sort=title-asc&view=list',
      ),
    );
    expect(writeLibraryQuery(parsed).toString()).toContain('view=list');
    expect(readLibraryQuery(new URLSearchParams('sort=unknown&view=cards'))).toMatchObject({
      sort: 'updated-desc',
      view: 'grid',
    });
  });

  it('searches title and ingredients, combines filters and sorts', () => {
    const favorite = recipe({ favorite: true, updatedAt: '2026-09-02T10:00:00.000Z' });
    const shared = recipe({
      id: crypto.randomUUID(),
      title: 'Паста',
      ingredientNames: ['Томаты'],
      visibility: 'workspace',
      updatedAt: '2026-09-04T10:00:00.000Z',
    });
    const query = readLibraryQuery(new URLSearchParams('q=томаты&favorite=1'));
    expect(selectLibraryRecipes([shared, favorite], query)).toEqual([favorite]);
    expect(
      selectLibraryRecipes([favorite, shared], readLibraryQuery(new URLSearchParams())).map(
        (item) => item.id,
      ),
    ).toEqual([shared.id, favorite.id]);
  });
});
