import { describe, expect, it } from 'vitest';
import {
  recipeAggregateSchema,
  recipeContentSchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
  recipeSchema,
  recipeIngredientSchema,
  recipeStepSchema,
  tagSchema,
  recipeSummarySchema,
} from './recipe';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const audit = { createdAt: '2026-09-03T12:00:00Z', updatedAt: '2026-09-03T12:00:00Z', revision: 1 };
const content = {
  title: 'Суп',
  description: '',
  servings: null,
  prepMinutes: 0,
  cookMinutes: null,
  sourceUrl: '',
  notes: '',
};
const ingredient = {
  sectionTitle: '',
  position: 0,
  name: 'Соль',
  quantityValue: null,
  quantityText: 'по вкусу',
  unit: '',
  note: '',
  isOptional: false,
};
const step = { sectionTitle: '', position: 0, body: 'Варить', durationSeconds: null };
const recipe = {
  ...content,
  ...audit,
  id,
  workspaceId: id,
  ownerUserId: id,
  visibility: 'private',
  status: 'draft',
  deletedAt: null,
};
const tag = {
  ...audit,
  id,
  workspaceId: id,
  createdBy: id,
  name: 'На ужин',
  normalizedName: 'на ужин',
  colorToken: 'neutral',
  status: 'active',
};
const aggregate = {
  recipe,
  ingredients: [{ ...ingredient, ...audit, id, recipeId: id }],
  steps: [{ ...step, ...audit, id, recipeId: id }],
  photos: [],
  tags: [tag],
  recipeTags: [{ ...audit, recipeId: id, tagId: id, assignedBy: id }],
};
const value = { content, ingredients: [ingredient], steps: [step], tagIds: [id] };

describe('recipe contracts', () => {
  it('accepts structured content and defaults creation to private', () => {
    expect(recipeAggregateSchema.parse(aggregate)).toEqual(aggregate);
    expect(recipeCreateInputSchema.parse({ value }).visibility).toBe('private');
    expect(
      recipeUpdateInputSchema.safeParse({ recipeId: id, expectedRevision: 1, value }).success,
    ).toBe(true);
    expect(
      recipeCreateInputSchema.safeParse({
        value: { ...value, ingredients: [], steps: [], tagIds: [] },
      }).success,
    ).toBe(true);
  });
  it.each([
    { title: ' ' },
    { servings: 0 },
    { servings: -1 },
    { prepMinutes: -1 },
    { cookMinutes: 1.5 },
    { prepMinutes: Number.POSITIVE_INFINITY },
    { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'data:text/html,test' },
    { sourceUrl: 'file:///secrets' },
    { sourceUrl: 'https://example.com:65536/recipe' },
    { sourceUrl: 'https://example.com/path\u0000' },
    { sourceUrl: 'not a url' },
    { title: 'a'.repeat(201) },
  ])('rejects invalid recipe content %j', (patch) => {
    expect(recipeContentSchema.safeParse({ ...content, ...patch }).success).toBe(false);
  });
  it.each(['https://example.com/recipe', 'http://example.com/recipe'])(
    'accepts source %s',
    (sourceUrl) => {
      expect(recipeContentSchema.safeParse({ ...content, sourceUrl }).success).toBe(true);
    },
  );
  it.each([
    { ownerUserId: other },
    { workspaceId: other },
    { status: 'published' },
    { revision: 99 },
    { createdAt: audit.createdAt },
    { role: 'owner' },
  ])('rejects server field injection %j', (patch) => {
    expect(recipeCreateInputSchema.safeParse({ value, ...patch }).success).toBe(false);
    expect(
      recipeUpdateInputSchema.safeParse({ recipeId: id, expectedRevision: 1, value, ...patch })
        .success,
    ).toBe(false);
  });
  it('rejects spoofed child parents and new child IDs', () => {
    expect(
      recipeCreateInputSchema.safeParse({
        value: { ...value, ingredients: [{ ...ingredient, recipeId: other }] },
      }).success,
    ).toBe(false);
    expect(
      recipeCreateInputSchema.safeParse({ value: { ...value, steps: [{ ...step, id }] } }).success,
    ).toBe(false);
  });
  it.each([
    { ingredients: [{ ...aggregate.ingredients[0], recipeId: other }] },
    { steps: [{ ...aggregate.steps[0], recipeId: other }] },
    { ingredients: [aggregate.ingredients[0], aggregate.ingredients[0]] },
    { steps: [aggregate.steps[0], { ...aggregate.steps[0], id: other }] },
    { tags: [{ ...tag, workspaceId: other }] },
    { tags: [tag, tag] },
    {
      tags: [tag, { ...tag, id: other }],
      recipeTags: [...aggregate.recipeTags, { ...aggregate.recipeTags[0], tagId: other }],
    },
    { recipeTags: [{ ...aggregate.recipeTags[0], recipeId: other }] },
    { recipeTags: [{ ...aggregate.recipeTags[0], tagId: other }] },
    { recipeTags: [aggregate.recipeTags[0], aggregate.recipeTags[0]] },
    { recipeTags: [] },
    { tags: [] },
  ])('rejects broken aggregate relationships %#', (patch) => {
    expect(recipeAggregateSchema.safeParse({ ...aggregate, ...patch }).success).toBe(false);
  });
  it.each([
    { ingredients: [ingredient, ingredient] },
    { steps: [step, step] },
    { tagIds: [id, id] },
    {
      ingredients: [
        { ...ingredient, id },
        { ...ingredient, id, position: 1 },
      ],
    },
    {
      steps: [
        { ...step, id },
        { ...step, id, position: 1 },
      ],
    },
  ])('rejects duplicate write IDs and positions %#', (patch) => {
    expect(
      recipeUpdateInputSchema.safeParse({
        recipeId: id,
        expectedRevision: 1,
        value: { ...value, ...patch },
      }).success,
    ).toBe(false);
  });
  it('validates timestamps, revisions and soft deletion', () => {
    expect(recipeSchema.safeParse({ ...recipe, status: 'deleted' }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...recipe, deletedAt: audit.updatedAt }).success).toBe(false);
    expect(
      recipeSchema.safeParse({ ...recipe, status: 'deleted', deletedAt: audit.updatedAt }).success,
    ).toBe(true);
    expect(
      recipeSchema.safeParse({ ...recipe, status: 'deleted', deletedAt: '2026-09-04T12:00:00Z' })
        .success,
    ).toBe(false);
    expect(recipeSchema.safeParse({ ...recipe, updatedAt: '2026-01-01T00:00:00Z' }).success).toBe(
      false,
    );
    expect(recipeSchema.safeParse({ ...recipe, revision: 0 }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...recipe, revision: Number.MAX_SAFE_INTEGER }).success).toBe(
      false,
    );
  });
  it('validates child quantities and timers and normalized tags', () => {
    expect(
      recipeIngredientSchema.safeParse({ ...aggregate.ingredients[0], quantityValue: 0 }).success,
    ).toBe(false);
    expect(recipeStepSchema.safeParse({ ...aggregate.steps[0], durationSeconds: -1 }).success).toBe(
      false,
    );
    expect(tagSchema.safeParse({ ...tag, normalizedName: 'На ужин' }).success).toBe(false);
    expect(tagSchema.safeParse({ ...tag, name: 'На   ужин' }).success).toBe(true);
    expect(tagSchema.safeParse({ ...tag, colorToken: 'url(javascript:alert(1))' }).success).toBe(
      false,
    );
  });
  it('bounds aggregate sizes and prevents notes from entering summaries', () => {
    expect(
      recipeCreateInputSchema.safeParse({
        value: {
          ...value,
          ingredients: Array.from({ length: 201 }, (_, position) => ({ ...ingredient, position })),
        },
      }).success,
    ).toBe(false);
    expect(recipeSummarySchema.safeParse(recipe).success).toBe(false);
  });
});
