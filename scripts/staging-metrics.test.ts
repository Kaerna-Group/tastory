import { describe, expect, it, vi } from 'vitest';
import { runBenchmark, summarize, validateBenchmarkURL } from './staging-metrics';
import type { Sample } from './staging-metrics';

const url = 'https://script.google.com/macros/s/test-deployment/exec';
function sample(elapsedMs: number, extra: Partial<Sample> = {}): Sample {
  return {
    case: 'health',
    warmup: false,
    requestId: '',
    requestBytes: 1,
    responseBytes: 1,
    elapsedMs,
    httpStatus: 200,
    error: null,
    ...extra,
  };
}
function reply(
  body: unknown,
  status = 200,
  responseURL = 'https://script.googleusercontent.com/macros/echo',
) {
  const response = new Response(JSON.stringify(body), { status });
  Object.defineProperties(response, { url: { value: responseURL }, redirected: { value: true } });
  return response;
}
function result(body: string) {
  const request = JSON.parse(body);
  return {
    ok: true,
    requestId: request.requestId,
    meta: { apiVersion: 1, schemaVersion: 0 },
    data:
      request.action === 'echo'
        ? request.payload
        : {
            status: 'ok',
            service: 'tastory-api',
            deploymentVersion: 'test',
            timestamp: new Date().toISOString(),
            storage: 'not-configured',
            auth: 'staging',
          },
  };
}

describe('staging measurements', () => {
  it('uses nearest rank, excludes warmups and errors, and preserves failure counts', () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample((i + 1) * 100)).reverse();
    samples.push(sample(90_000, { warmup: true }), sample(15_000, { error: 'TIMEOUT' }));
    expect(summarize(samples)).toEqual({
      attempted: 21,
      succeeded: 20,
      failed: 1,
      minMs: 100,
      p50Ms: 1000,
      p95Ms: 1900,
      maxMs: 2000,
    });
    expect(summarize([sample(15_000, { error: 'TIMEOUT' })])).toEqual({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    });
  });

  it('measures UTF-8 bytes, interleaves cases, sends no credentials, and does not overlap requests', async () => {
    let active = false;
    const bodies: string[] = [];
    const send = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe(url);
      expect(active).toBe(false);
      active = true;
      expect(init?.credentials).toBe('omit');
      expect(init?.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
      const body = String(init?.body);
      expect(JSON.parse(body)).not.toHaveProperty('credential');
      bodies.push(body);
      await Promise.resolve();
      active = false;
      return reply(result(body));
    });
    const report = await runBenchmark(url, 2, { fetch: send });
    expect(report.passed).toBe(true);
    expect(send).toHaveBeenCalledTimes(9);
    expect(report.samples.map((item) => item.case)).toEqual(
      Array.from({ length: 3 }, () => ['health', 'echo-ascii-1024', 'echo-unicode-1024']).flat(),
    );
    expect(report.samples.filter((item) => item.warmup)).toHaveLength(3);
    report.samples.forEach((item, index) =>
      expect(item.requestBytes).toBe(Buffer.byteLength(bodies[index] ?? '')),
    );
    expect((report.samples[2]?.requestBytes ?? 0) - (report.samples[1]?.requestBytes ?? 0)).toBe(
      2048,
    );
    expect(report.summary.every((item) => item.succeeded === 2)).toBe(true);
  });

  it.each([
    ['HTTP_ERROR', (body: string) => reply(result(body), 503)],
    [
      'UNEXPECTED_REDIRECT',
      (body: string) => reply(result(body), 200, 'https://accounts.google.com/'),
    ],
    [
      'REQUEST_ID_MISMATCH',
      (body: string) =>
        reply({ ...result(body), requestId: '388decd6-7280-423e-9f62-5d5bc2b45047' }),
    ],
    ['INVALID_RESPONSE', () => reply({ ok: true })],
    [
      'ACTION_DISABLED',
      (body: string) =>
        reply({
          ok: false,
          requestId: result(body).requestId,
          error: { code: 'ACTION_DISABLED', message: 'Disabled' },
        }),
    ],
    [
      'TIMEOUT',
      () => {
        throw new DOMException('secret detail', 'TimeoutError');
      },
    ],
  ] as const)(
    'fails readiness with %s and keeps no response body or error detail',
    async (code, respond) => {
      const send = vi.fn<typeof fetch>(async (_input, init) => respond(String(init?.body)));
      const report = await runBenchmark(url, 20, { fetch: send });
      expect(report.passed).toBe(false);
      expect(report.complete).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
      expect(report.samples[0]?.error).toBe(code);
      expect(JSON.stringify(report)).not.toContain('secret detail');
      expect(report.summary.every((item) => item.p50Ms === null)).toBe(true);
    },
  );

  it('does not hide intermittent failures, and stops after three consecutive failures', async () => {
    let call = 0;
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      call += 1;
      if (call === 4 || call >= 6) throw new Error('network');
      return reply(result(String(init?.body)));
    });
    const report = await runBenchmark(url, 20, { fetch: send });
    expect(send).toHaveBeenCalledTimes(8);
    expect(report.complete).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.summary.reduce((total, item) => total + item.failed, 0)).toBe(4);
  });

  it('rejects echoed content changes and unconfigured staging', async () => {
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      const data = result(String(init?.body));
      if ('message' in data.data) data.data.message = 'altered';
      return reply(data);
    });
    expect((await runBenchmark(url, 1, { fetch: send })).samples.at(-1)?.error).toBe(
      'ECHO_MISMATCH',
    );
    const unconfigured = vi.fn<typeof fetch>(async (_input, init) => {
      const data = result(String(init?.body));
      data.data.auth = 'not-configured';
      return reply(data);
    });
    expect((await runBenchmark(url, 1, { fetch: unconfigured })).samples[0]?.error).toBe(
      'STAGING_NOT_CONFIGURED',
    );
  });

  it('rejects invalid targets and unbounded counts before making requests', async () => {
    for (const target of [
      'http://localhost/',
      url + '?credential=secret',
      url + '#fragment',
      url.replace('/exec', '/dev'),
    ])
      expect(() => validateBenchmarkURL(target)).toThrow();
    const send = vi.fn<typeof fetch>();
    for (const count of [0, 21, 1.5, NaN])
      await expect(runBenchmark(url, count, { fetch: send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
