import { describe, expect, it, vi } from 'vitest';
import { createApiClient, createHttpTransport } from './client';
import { mockTransport } from './mock-transport';

const requestId = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
const request = { apiVersion: 1, requestId, action: 'health', payload: {} } as const;
describe('typed API client', () => {
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
    expect((await client.authenticate('token')).user.id).toBe('sub');
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.signIn', credential: 'token', payload: {} }),
      undefined,
    );
    transport.mockResolvedValue({ ...response, requestId: 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac' });
    await expect(client.authenticate('token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    transport.mockResolvedValue({
      ...response,
      data: { ...response.data, expiresAt: '2020-01-01T00:00:00Z' },
    });
    await expect(client.authenticate('token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(createApiClient(mockTransport).authenticate('token')).rejects.toMatchObject({
      code: 'AUTH_NOT_CONFIGURED',
    });
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
