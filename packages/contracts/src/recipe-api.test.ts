import { describe, expect, it } from 'vitest';
import { apiRequestSchema, recipeResponseSchema } from './api';
import { recipeCommandSchema } from './recipe-api';

const requestId = '11111111-1111-4111-8111-111111111111';
describe('recipe HTTP contracts', () => {
  it.each(['recipes.archive', 'recipes.restore'] as const)(
    'requires revision and authentication for %s',
    (action) => {
      const request = {
        apiVersion: 1,
        requestId,
        credential: 'token',
        action,
        payload: { recipeId: requestId, expectedRevision: 1 },
      };
      expect(apiRequestSchema.safeParse(request).success).toBe(true);
      expect(apiRequestSchema.safeParse({ ...request, credential: undefined }).success).toBe(false);
      expect(
        apiRequestSchema.safeParse({ ...request, payload: { recipeId: requestId } }).success,
      ).toBe(false);
      expect(
        apiRequestSchema.safeParse({
          ...request,
          payload: { ...request.payload, expectedRevision: 0 },
        }).success,
      ).toBe(false);
      expect(
        apiRequestSchema.safeParse({
          ...request,
          payload: { ...request.payload, ownerUserId: requestId },
        }).success,
      ).toBe(false);
    },
  );
  it('keeps recovery actions bounded and does not expose arbitrary writes', () => {
    expect(
      recipeCommandSchema.safeParse({
        action: 'recipes.operations.resume',
        payload: { operationId: requestId },
      }).success,
    ).toBe(true);
    expect(
      recipeCommandSchema.safeParse({
        action: 'recipes.operations.cancel',
        payload: { operationId: requestId, state: 'committed' },
      }).success,
    ).toBe(false);
    expect(
      recipeCommandSchema.safeParse({ action: 'recipes.deleteAll', payload: {} }).success,
    ).toBe(false);
  });
  it.each([
    'RECIPE_CONFLICT',
    'RECIPE_PENDING',
    'RECIPE_CANCELLED',
    'RECIPE_NOT_READY',
    'RECIPE_LIMIT',
  ])('accepts stable %s errors', (code) => {
    expect(
      recipeResponseSchema.safeParse({ ok: false, requestId, error: { code, message: 'Ошибка' } })
        .success,
    ).toBe(true);
  });
});
