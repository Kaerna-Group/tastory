import { expect, it } from 'vitest';
import { recipeTransferDocumentSchema } from './recipe-transfer';

const recipeId = '11111111-1111-4111-8111-111111111111';
const stepId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';
const recipe = () => {
  return {
    sourceId: recipeId,
    sourceRevision: 3,
    visibility: 'private' as const,
    status: 'draft' as const,
    content: {
      title: 'Суп',
      description: '',
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 20,
      sourceUrl: '',
      notes: '',
    },
    ingredients: [],
    steps: [
      {
        sourceId: stepId,
        sectionTitle: '',
        position: 0,
        body: 'Сварить',
        durationSeconds: null,
      },
    ],
    tags: [],
    photos: [],
  };
};

it('accepts the versioned portable recipe and book envelopes', () => {
  const item = recipe();
  expect(
    recipeTransferDocumentSchema.parse({
      format: 'tastory.recipe-book',
      version: 1,
      kind: 'recipe',
      exportedAt: new Date().toISOString(),
      recipes: [item],
    }).recipes[0]?.sourceId,
  ).toBe(item.sourceId);
});

it('rejects duplicate recipes and photos that point at an unknown step', () => {
  const item = recipe();
  expect(() =>
    recipeTransferDocumentSchema.parse({
      format: 'tastory.recipe-book',
      version: 1,
      kind: 'book',
      exportedAt: new Date().toISOString(),
      recipes: [item, item],
    }),
  ).toThrow();
  expect(() =>
    recipeTransferDocumentSchema.parse({
      format: 'tastory.recipe-book',
      version: 1,
      kind: 'recipe',
      exportedAt: new Date().toISOString(),
      recipes: [
        {
          ...item,
          photos: [
            {
              sourceId: photoId,
              kind: 'step',
              stepSourceId: otherId,
              position: 0,
              width: 1,
              height: 1,
              image: { bytes: 1, digest: 'a'.repeat(64), base64: 'YQ==' },
              thumbnail: { bytes: 1, digest: 'a'.repeat(64), base64: 'YQ==' },
            },
          ],
        },
      ],
    }),
  ).toThrow();
});
