import { vi } from 'vitest';
import type { AuthData, RecipeAggregate } from '@tastory/contracts';
import type { RecipeModelContext } from '../services/recipe-model';

export const recipeIds = {
  owner: '11111111-1111-4111-8111-111111111111',
  author: '22222222-2222-4222-8222-222222222222',
  viewer: '33333333-3333-4333-8333-333333333333',
  other: '44444444-4444-4444-8444-444444444444',
  workspace: '55555555-5555-4555-8555-555555555555',
  recipe: '66666666-6666-4666-8666-666666666666',
  ingredient: '77777777-7777-4777-8777-777777777777',
  step: '88888888-8888-4888-8888-888888888888',
  tag: '99999999-9999-4999-8999-999999999999',
  foreign: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
const timestamp = '2026-09-03T12:00:00.000Z';
const audit = { createdAt: timestamp, updatedAt: timestamp, revision: 1 };

export function recipeFixture(who: 'owner' | 'author' | 'viewer' | 'other' = 'author') {
  const ids = recipeIds;
  const directory = {
    users: (['owner', 'author', 'viewer', 'other'] as const).map((name) => ({
      user_id: ids[name],
      google_sub: `${name}-sub`,
      email: `${name}@example.test`,
      email_normalized: `${name}@example.test`,
      display_name: name,
      avatar_asset_id: '',
      status: 'active',
      created_at: timestamp,
      last_login_at: '',
      row_revision: '1',
    })),
    workspaces: [
      {
        workspace_id: ids.workspace,
        name: 'Book',
        owner_user_id: ids.owner,
        default_app_theme_id: '',
        default_canvas_theme_id: '',
        created_at: timestamp,
        updated_at: timestamp,
        row_revision: '1',
      },
    ],
    members: (['owner', 'author', 'viewer', 'other'] as const).map((name) => ({
      workspace_id: ids.workspace,
      user_id: ids[name],
      role: name === 'owner' ? 'owner' : name === 'viewer' ? 'viewer' : 'member',
      status: 'active',
      joined_at: timestamp,
      row_revision: '1',
    })),
  };
  const aggregate: RecipeAggregate = {
    recipe: {
      ...audit,
      id: ids.recipe,
      workspaceId: ids.workspace,
      ownerUserId: ids.author,
      title: 'Суп',
      description: 'На обед',
      servings: 2,
      prepMinutes: 10,
      cookMinutes: 20,
      sourceUrl: '',
      notes: 'Личный секрет',
      visibility: 'private',
      status: 'draft',
      deletedAt: null,
    },
    ingredients: [
      {
        ...audit,
        id: ids.ingredient,
        recipeId: ids.recipe,
        sectionTitle: '',
        position: 0,
        name: 'Соль',
        quantityValue: null,
        quantityText: 'по вкусу',
        unit: '',
        note: '',
        isOptional: false,
      },
    ],
    steps: [
      {
        ...audit,
        id: ids.step,
        recipeId: ids.recipe,
        sectionTitle: '',
        position: 0,
        body: 'Варить',
        durationSeconds: 1200,
      },
    ],
    photos: [],
    tags: [
      {
        ...audit,
        id: ids.tag,
        workspaceId: ids.workspace,
        name: 'Супы',
        normalizedName: 'супы',
        createdBy: ids.author,
        colorToken: 'neutral',
        status: 'active',
      },
    ],
    recipeTags: [{ ...audit, recipeId: ids.recipe, tagId: ids.tag, assignedBy: ids.author }],
  };
  const reader = {
    getRecipe: vi.fn((id: string): unknown =>
      id === aggregate.recipe.id ? aggregate.recipe : null,
    ),
    getIngredient: vi.fn(
      (id: string): unknown => aggregate.ingredients.find((child) => child.id === id) ?? null,
    ),
    getStep: vi.fn(
      (id: string): unknown => aggregate.steps.find((child) => child.id === id) ?? null,
    ),
    getTag: vi.fn((id: string): unknown => aggregate.tags.find((tag) => tag.id === id) ?? null),
    getRecipeTag: vi.fn(
      (recipeId: string, tagId: string): unknown =>
        aggregate.recipeTags.find((link) => link.recipeId === recipeId && link.tagId === tagId) ??
        null,
    ),
    getAggregate: vi.fn((): unknown => aggregate),
    listRecipes: vi.fn((): readonly unknown[] => [aggregate.recipe]),
    listTags: vi.fn((): readonly unknown[] => aggregate.tags),
    isRecipeFavorite: vi.fn(() => false),
  };
  const session: AuthData = {
    user: {
      id: `${who}-sub`,
      email: `${who}@example.test`,
      name: who,
      // Deliberately stale role: every service must use the freshly loaded membership instead.
      role: 'owner',
    },
    expiresAt: '2026-09-03T13:00:00.000Z',
  };
  const context: RecipeModelContext = {
    session,
    workspaceId: ids.workspace,
    readDirectory: () => directory,
    reader,
    now: () => new Date(timestamp),
  };
  const value = {
    content: {
      title: 'Новый суп',
      description: '',
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      sourceUrl: '',
      notes: 'Заметка',
    },
    ingredients: [
      {
        sectionTitle: '',
        position: 0,
        name: 'Соль',
        quantityValue: null,
        quantityText: 'по вкусу',
        unit: '',
        note: '',
        isOptional: false,
      },
    ],
    steps: [{ sectionTitle: '', position: 0, body: 'Варить', durationSeconds: null }],
    tagIds: [ids.tag],
  };
  const update = { recipeId: ids.recipe, expectedRevision: 1, value };
  return { ids, directory, aggregate, reader, context, value, update };
}
