import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient, createHttpTransport } from './client';
import { mockTransport } from './mock-transport';

const requestId = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
const request = { apiVersion: 1, requestId, action: 'health', payload: {} } as const;
describe('typed API client', () => {
  it('keeps journal request IDs stable and rejects mismatched actions or operation receipts', async () => {
    const entry = {
      id: requestId,
      action: 'admin.operations.check',
      actorName: 'Owner',
      status: 'committed',
      startedAt: '2026-09-03T12:00:00Z',
      completedAt: '2026-09-03T12:00:00Z',
      auditRecorded: true,
      canRetry: false,
    };
    const response = {
      ok: true,
      requestId,
      meta: { apiVersion: 1, schemaVersion: 0 },
      data: {
        kind: 'check',
        outcome: 'replayed',
        entry,
        result: { kind: 'journal-check', verified: true },
      },
    };
    const transport = vi.fn().mockResolvedValue(response);
    const client = createApiClient(transport);
    await client.journal('admin.operations.check', 'memory-token', requestId);
    await client.journal('admin.operations.check', 'memory-token', requestId);
    expect(transport.mock.calls.map(([request]) => request.requestId)).toEqual([
      requestId,
      requestId,
    ]);
    await expect(
      client.journal('admin.operations.list', 'memory-token', requestId),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    transport.mockResolvedValue({
      ...response,
      data: { ...response.data, entry: { ...entry, id: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac' } },
    });
    await expect(
      client.journal('admin.operations.check', 'memory-token', requestId),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    transport.mockResolvedValue({
      ok: false,
      requestId,
      error: { code: 'JOURNAL_LIMIT', message: 'Заполнен.' },
    });
    await expect(
      client.journal('admin.operations.check', 'memory-token', requestId),
    ).rejects.toMatchObject({ code: 'JOURNAL_LIMIT', requestId });
  });
  it.each(['adminUsers', 'adminHealth'] as const)(
    'validates %s responses and request correlation',
    async (method) => {
      const common = {
        workspace: { id: requestId, name: 'Книга' },
        checkedAt: '2026-09-03T12:00:00Z',
      };
      const data =
        method === 'adminUsers'
          ? {
              ...common,
              users: [
                {
                  id: requestId,
                  email: 'owner@example.test',
                  displayName: '',
                  role: 'owner',
                  userStatus: 'active',
                  membershipStatus: 'active',
                  joinedAt: common.checkedAt,
                },
              ],
            }
          : {
              ...common,
              status: 'ok',
              schemaVersion: 1,
              tablesChecked: 6,
              members: 2,
              activeMembers: 2,
            };
      const response = { ok: true, requestId, data, meta: { apiVersion: 1, schemaVersion: 0 } };
      const transport = vi.fn().mockResolvedValue(response);
      const client = createApiClient(transport, () => requestId);
      expect(await client[method]('memory-token')).toEqual(data);
      expect(transport).toHaveBeenCalledWith(
        {
          apiVersion: 1,
          requestId,
          action: method === 'adminUsers' ? 'admin.users.list' : 'admin.health',
          payload: {},
          credential: 'memory-token',
        },
        undefined,
      );
      transport.mockResolvedValue({
        ...response,
        requestId: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac',
      });
      await expect(client[method]('memory-token')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        requestId,
      });
      transport.mockResolvedValue({
        ...response,
        data: { ...data, google_sub: 'should-not-be-returned' },
      });
      await expect(client[method]('memory-token')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
      transport.mockResolvedValue({
        ok: false,
        requestId,
        error: { code: 'ACCESS_DENIED', message: 'Доступ закрыт.' },
      });
      await expect(client[method]('memory-token')).rejects.toMatchObject({
        code: 'ACCESS_DENIED',
        requestId,
      });
    },
  );
  it('correlates concurrency responses with both request and run and preserves errors', async () => {
    const command = { action: 'spike.concurrency.read', payload: { runId: requestId } } as const;
    const data = {
      outcome: 'read',
      state: { runId: requestId, revision: 0, value: null },
      appliedOperations: 0,
      operationRevision: null,
    };
    const response = { ok: true, requestId, data, meta: { apiVersion: 1, schemaVersion: 0 } };
    const transport = vi.fn().mockResolvedValue(response);
    const client = createApiClient(transport, () => requestId);
    expect(await client.concurrency(command, 'token')).toEqual(data);
    transport.mockResolvedValue({
      ...response,
      data: { ...data, state: { ...data.state, runId: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac' } },
    });
    await expect(client.concurrency(command, 'token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    transport.mockResolvedValue({
      ok: false,
      requestId,
      error: { code: 'PROBE_LIMIT', message: 'Лимит.' },
    });
    await expect(client.concurrency(command, 'token')).rejects.toMatchObject({
      code: 'PROBE_LIMIT',
    });
  });
  it('validates protected photo responses and request correlation', async () => {
    const command = { action: 'spike.photo.read', payload: {} } as const;
    const response = {
      ok: true,
      requestId,
      data: { photo: null, thumbnailBase64: null },
      meta: { apiVersion: 1, schemaVersion: 0 },
    };
    const transport = vi.fn().mockResolvedValue(response);
    const client = createApiClient(transport, () => requestId);
    expect(await client.photo(command, 'token')).toEqual(response.data);
    expect(transport).toHaveBeenCalledWith(
      { ...command, apiVersion: 1, requestId, credential: 'token' },
      undefined,
    );
    transport.mockResolvedValue({ ...response, requestId: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac' });
    await expect(client.photo(command, 'token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    transport.mockResolvedValue({
      ok: false,
      requestId,
      error: { code: 'PHOTO_NOT_PRIVATE', message: 'Доступ открыт.' },
    });
    await expect(client.photo(command, 'token')).rejects.toMatchObject({
      code: 'PHOTO_NOT_PRIVATE',
    });
  });
  it('validates auth response, correlation, expiry and error codes', async () => {
    const response = {
      ok: true,
      requestId,
      data: {
        user: { id: 'sub', email: 'chef@gmail.com', name: 'Chef', role: 'owner' },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      meta: { apiVersion: 1, schemaVersion: 0 },
    };
    const transport = vi.fn().mockResolvedValue(response);
    const client = createApiClient(transport, () => requestId);
    expect(await client.authenticate('token')).toMatchObject({ user: { id: 'sub' }, requestId });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.signIn', credential: 'token', payload: {} }),
      undefined,
    );
    transport.mockResolvedValue({ ...response, requestId: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac' });
    await expect(client.authenticate('token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      requestId,
    });
    transport.mockResolvedValue({
      ...response,
      data: { ...response.data, expiresAt: '2020-01-01T00:00:00Z' },
    });
    await expect(client.authenticate('token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(createApiClient(mockTransport).authenticate('token')).rejects.toMatchObject({
      code: 'AUTH_NOT_CONFIGURED',
    });
  });
  it('attaches auth request identifiers to transport errors while preserving cancellation', async () => {
    const transport = vi
      .fn()
      .mockRejectedValue(new ApiClientError('TRANSPORT_ERROR', 'Unavailable'));
    const client = createApiClient(transport, () => requestId);
    await expect(client.authenticate('token')).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      requestId,
    });
    const cancelled = new DOMException('Cancelled', 'AbortError');
    transport.mockRejectedValue(cancelled);
    await expect(client.authenticate('token')).rejects.toBe(cancelled);
  });
  it('validates mock fixtures using the real contract', async () => {
    expect(await createApiClient(mockTransport, () => requestId).health()).toMatchObject({
      status: 'ok',
      storage: 'not-configured',
    });
  });
  it.each([{ hello: 'world' }, { ok: true, requestId: 'wrong' }])(
    'rejects malformed responses',
    async (response) => {
      await expect(
        createApiClient(
          () => Promise.resolve(response),
          () => requestId,
        ).health(),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );
  it('rejects a valid response for another request', async () => {
    const transport = () =>
      mockTransport({ ...request, requestId: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac' });
    await expect(createApiClient(transport, () => requestId).health()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('preserves API error codes', async () => {
    const transport = () =>
      Promise.resolve({
        ok: false,
        requestId,
        error: { code: 'ACTION_DISABLED', message: 'Disabled' },
      });
    await expect(createApiClient(transport, () => requestId).health()).rejects.toMatchObject({
      code: 'ACTION_DISABLED',
    });
  });
  it('sends JSON as text/plain without credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await createHttpTransport('https://example.test/api', fetcher)(request);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        credentials: 'omit',
        body: JSON.stringify(request),
      }),
    );
  });
  it.each([new Response('', { status: 500 }), new Response('<html>login</html>')])(
    'handles HTTP and non-JSON failures',
    async (response) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        createHttpTransport('https://example.test/api', fetcher)(request),
      ).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
    },
  );
  it('handles network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network error'));
    await expect(
      createHttpTransport('https://example.test/api', fetcher)(request),
    ).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
  });
  it('preserves caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Cancelled'));
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(controller.signal.reason);
    await expect(
      createHttpTransport('https://example.test/api', fetcher)(request, controller.signal),
    ).rejects.toThrow('Cancelled');
  });
  it('uses a generated request ID by default', async () => {
    expect(await createApiClient(mockTransport).health()).toMatchObject({ status: 'ok' });
  });
});
