import { describe, expect, it, vi } from 'vitest';
import { authResponseSchema } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { handleRequest } from './handle-request';
const requestId = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
const context = {
  now: () => new Date(),
  createRequestId: () => requestId,
  isEchoEnabled: false,
  deploymentVersion: 'test',
};
const request = {
  apiVersion: 1,
  requestId,
  action: 'auth.signIn',
  credential: 'token',
  payload: {},
};
describe('protected API routes', () => {
  it('fails closed without an authenticator and rejects missing credentials', () => {
    expect(handleRequest(request, context)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_NOT_CONFIGURED' },
    });
    expect(handleRequest({ ...request, credential: undefined }, context)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });
  it.each(['auth.signIn', 'auth.me'])(
    'verifies credentials for %s and preserves requestId',
    (action) => {
      const authenticate = vi.fn(() => ({
        user: { id: 'sub', email: 'chef@gmail.com', name: 'Chef', role: 'owner' as const },
        expiresAt: '2026-09-03T13:00:00Z',
      }));
      const response = handleRequest({ ...request, action }, { ...context, authenticate });
      expect(authResponseSchema.safeParse(response).success).toBe(true);
      expect(authenticate).toHaveBeenCalledWith('token', action === 'auth.signIn');
      expect(response).toMatchObject({ ok: true, requestId });
    },
  );
  it.each(['UNAUTHENTICATED', 'ACCESS_DENIED', 'AUTH_UNAVAILABLE'] as const)(
    'preserves %s without reflecting credentials',
    (code) => {
      expect(
        handleRequest(request, {
          ...context,
          authenticate: () => {
            throw new AuthError(code);
          },
        }),
      ).toMatchObject({ ok: false, error: { code } });
    },
  );
  it('does not expose internal errors or tokens', () => {
    const response = handleRequest(request, {
      ...context,
      authenticate: () => {
        throw new Error('private token details');
      },
    });
    expect(JSON.stringify(response)).not.toContain('private');
    expect(response).toMatchObject({ error: { code: 'AUTH_UNAVAILABLE' } });
  });
  it('reports configured staging auth', () => {
    expect(
      handleRequest(
        { apiVersion: 1, requestId, action: 'health', payload: {} },
        { ...context, isAuthConfigured: true },
      ),
    ).toMatchObject({ data: { auth: 'staging' } });
  });
});
