import { describe, expect, it } from 'vitest';
import { apiRequestSchema, healthResponseSchema } from './api';

const request = {
  apiVersion: 1,
  requestId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
  action: 'health',
  payload: {},
};

describe('API v1 boundary', () => {
  it('accepts the frontend health request', () => {
    expect(apiRequestSchema.parse(request)).toEqual(request);
  });
  it.each([
    { ...request, apiVersion: 2 },
    { ...request, requestId: 'invalid' },
    { ...request, action: 'recipes.delete' },
    { ...request, credential: 'unexpected' },
    { ...request, action: 'echo', payload: { message: 'a'.repeat(1025) } },
  ])('rejects incompatible or unsafe requests', (input) => {
    expect(apiRequestSchema.safeParse(input).success).toBe(false);
  });
  it('does not accept a health response as proof of configured storage', () => {
    expect(
      healthResponseSchema.safeParse({
        ok: true,
        requestId: request.requestId,
        data: { status: 'ok' },
        meta: { apiVersion: 1, schemaVersion: 1 },
      }).success,
    ).toBe(false);
  });
});
