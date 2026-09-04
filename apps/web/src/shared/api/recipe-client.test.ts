import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import type { RecipeCommand } from '@tastory/contracts';

const requestId = '11111111-1111-4111-8111-111111111111';
const recipeId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const saved = {
  ok: true,
  requestId,
  meta: { apiVersion: 1, schemaVersion: 0 },
  data: {
    kind: 'saved',
    operationId: requestId,
    entityId: recipeId,
    entityType: 'recipe',
    revision: 2,
    outcome: 'committed',
  },
};
const archive: RecipeCommand = {
  action: 'recipes.archive',
  payload: { recipeId, expectedRevision: 1 },
};

describe('recipe API client', () => {
  it('preserves the same request ID and body on repeated saves', async () => {
    const transport = vi.fn().mockResolvedValue(saved);
    const client = createApiClient(transport);
    await client.recipes(archive, 'credential', requestId);
    await client.recipes(archive, 'credential', requestId);
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      ...archive,
      credential: 'credential',
      requestId,
    });
  });
  it.each([
    { requestId: operationId },
    { data: { ...saved.data, operationId } },
    { data: { ...saved.data, entityId: operationId } },
    { data: { ...saved.data, entityType: 'tag' } },
    { data: { ...saved.data, outcome: 'cancelled' } },
    { data: { kind: 'recipes', recipes: [] } },
  ])('rejects mismatched receipts %#', async (patch) => {
    const client = createApiClient(vi.fn().mockResolvedValue({ ...saved, ...patch }));
    await expect(client.recipes(archive, 'credential', requestId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      requestId,
    });
  });
  it('matches recovery/cancellation receipts to the original operation, not the transport request', async () => {
    const transport = vi.fn().mockResolvedValue({ ...saved, data: { ...saved.data, operationId } });
    const client = createApiClient(transport);
    await expect(
      client.recipes(
        { action: 'recipes.operations.resume', payload: { operationId } },
        'credential',
        requestId,
      ),
    ).resolves.toMatchObject({ operationId });
    await expect(
      client.recipes(
        { action: 'recipes.operations.cancel', payload: { operationId } },
        'credential',
        requestId,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    transport.mockResolvedValue({
      ...saved,
      data: { ...saved.data, operationId, outcome: 'cancelled' },
    });
    await expect(
      client.recipes(
        { action: 'recipes.operations.cancel', payload: { operationId } },
        'credential',
        requestId,
      ),
    ).resolves.toMatchObject({ outcome: 'cancelled' });
  });
  it('returns server conflicts with the original request ID and validates list results', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: false,
      requestId,
      error: { code: 'RECIPE_CONFLICT', message: 'Обновите рецепт.' },
    });
    const client = createApiClient(transport);
    await expect(client.recipes(archive, 'credential', requestId)).rejects.toMatchObject({
      code: 'RECIPE_CONFLICT',
      requestId,
    });
    transport.mockResolvedValue({ ...saved, data: { kind: 'recipes', recipes: [] } });
    await expect(
      client.recipes({ action: 'recipes.list', payload: {} }, 'credential', requestId),
    ).resolves.toEqual({ kind: 'recipes', recipes: [] });
  });
});
