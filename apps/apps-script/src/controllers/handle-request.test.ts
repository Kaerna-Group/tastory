import { describe, expect, it } from 'vitest';
import { echoResponseSchema, healthResponseSchema } from '@tastory/contracts';
import { handlePostBody, handleRequest } from './handle-request';
import type { RequestContext } from './handle-request';

const requestId = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
const context: RequestContext = {
  now: () => new Date('2026-09-02T12:00:00.000Z'),
  createRequestId: () => requestId,
  isEchoEnabled: false,
  deploymentVersion: 'test',
};

describe('Apps Script contracts', () => {
  it('returns health compatible with the frontend schema', () => {
    const response = handleRequest(
      { apiVersion: 1, requestId, action: 'health', payload: {} },
      context,
    );
    expect(healthResponseSchema.parse(response)).toMatchObject({
      ok: true,
      data: { storage: 'not-configured', auth: 'not-configured' },
      meta: { schemaVersion: 0 },
    });
  });
  it.each(['', '{broken', 'x'.repeat(8193), '{}'])(
    'rejects invalid bodies without reflecting their contents',
    (body) => {
      expect(handlePostBody(body, context)).toEqual({
        ok: false,
        requestId,
        error: { code: 'INVALID_REQUEST', message: 'Некорректный запрос API v1.' },
      });
    },
  );
  it('keeps echo disabled by default', () => {
    expect(
      handleRequest(
        { apiVersion: 1, requestId, action: 'echo', payload: { message: 'hello' } },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: 'ACTION_DISABLED' } });
  });
  it('enables limited echo only for the spike', () => {
    const response = handlePostBody(
      JSON.stringify({ apiVersion: 1, requestId, action: 'echo', payload: { message: 'hello' } }),
      { ...context, isEchoEnabled: true },
    );
    expect(echoResponseSchema.parse(response)).toMatchObject({
      ok: true,
      data: { message: 'hello' },
    });
  });
});
