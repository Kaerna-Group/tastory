import { randomUUID } from 'node:crypto';
import {
  API_VERSION,
  apiRequestSchema,
  echoResponseSchema,
  healthResponseSchema,
} from '@tastory/contracts';

const cases = [
  { name: 'health', action: 'health', payload: {} },
  { name: 'echo-ascii-1024', action: 'echo', payload: { message: 'a'.repeat(1024) } },
  { name: 'echo-unicode-1024', action: 'echo', payload: { message: '界'.repeat(1024) } },
] as const;

export type Sample = {
  case: (typeof cases)[number]['name'];
  warmup: boolean;
  requestId: string;
  requestBytes: number;
  responseBytes: number | null;
  elapsedMs: number;
  httpStatus: number | null;
  error: string | null;
};

/** Nearest-rank percentiles of successful requests; an empty series has no latency. */
export function summarize(samples: readonly Sample[]) {
  const measured = samples.filter((sample) => !sample.warmup);
  const times = measured
    .filter((sample) => sample.error === null)
    .map((sample) => sample.elapsedMs)
    .sort((a, b) => a - b);
  const percentile = (fraction: number) => times[Math.ceil(times.length * fraction) - 1] ?? null;
  return {
    attempted: measured.length,
    succeeded: times.length,
    failed: measured.length - times.length,
    minMs: times[0] ?? null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: times.at(-1) ?? null,
  };
}

export function validateBenchmarkURL(value: string) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(value)) {
    throw new Error('Нужен опубликованный staging URL https://script.google.com/macros/s/…/exec.');
  }
  return value;
}

function validateResponse(response: Response, text: string, request: unknown): string | null {
  if (response.status !== 200) return 'HTTP_ERROR';
  if (
    !response.redirected ||
    new URL(response.url).origin !== 'https://script.googleusercontent.com'
  )
    return 'UNEXPECTED_REDIRECT';
  const sent = apiRequestSchema.parse(request);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'INVALID_JSON';
  }
  const parsed = (sent.action === 'health' ? healthResponseSchema : echoResponseSchema).safeParse(
    json,
  );
  if (!parsed.success) return 'INVALID_RESPONSE';
  const result = parsed.data;
  if (result.requestId !== sent.requestId) return 'REQUEST_ID_MISMATCH';
  if (!result.ok) return result.error.code;
  if ('message' in result.data) {
    return sent.action === 'echo' && sent.payload.message === result.data.message
      ? null
      : 'ECHO_MISMATCH';
  }
  return result.data.auth === 'staging' ? null : 'STAGING_NOT_CONFIGURED';
}

export async function runBenchmark(
  url: string,
  rounds: number,
  options: {
    fetch?: typeof fetch;
    onSample?: (sample: Sample) => void;
  } = {},
) {
  validateBenchmarkURL(url);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20)
    throw new Error('Число измерений для каждого запроса должно быть целым от 1 до 20.');
  const send = options.fetch ?? fetch;
  const samples: Sample[] = [];
  const startedAt = new Date().toISOString();
  let aborted = false;
  let consecutiveFailures = 0;
  // One warmup per case, then interleaved cases to reduce ordering bias. No retries or writes.
  roundsLoop: for (let round = 0; round <= rounds; round += 1) {
    for (const probe of cases) {
      const request = apiRequestSchema.parse({
        apiVersion: API_VERSION,
        requestId: randomUUID(),
        action: probe.action,
        payload: probe.payload,
      });
      const body = JSON.stringify(request);
      const sample: Sample = {
        case: probe.name,
        warmup: round === 0,
        requestId: request.requestId,
        requestBytes: Buffer.byteLength(body, 'utf8'),
        responseBytes: null,
        elapsedMs: 0,
        httpStatus: null,
        error: null,
      };
      const start = performance.now();
      try {
        const response = await send(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          credentials: 'omit',
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
          body,
        });
        sample.httpStatus = response.status;
        const text = await response.text();
        sample.responseBytes = Buffer.byteLength(text, 'utf8');
        sample.error = validateResponse(response, text, request);
      } catch (error) {
        sample.error =
          error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      }
      sample.elapsedMs = Math.round(performance.now() - start);
      samples.push(sample);
      options.onSample?.({ ...sample });
      consecutiveFailures = sample.error === null ? 0 : consecutiveFailures + 1;
      // A failed readiness check or an unavailable service must not generate a long request storm.
      if ((round === 0 && sample.error !== null) || consecutiveFailures >= 3) {
        aborted = true;
        break roundsLoop;
      }
    }
  }
  return {
    formatVersion: 1,
    kind: 'node-public-transport-baseline',
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: { runtime: process.version, platform: process.platform, arch: process.arch },
    settings: { rounds, warmupsPerCase: 1, concurrency: 1, retries: 0, timeoutMs: 15_000 },
    complete: !aborted,
    passed: !aborted && samples.every((sample) => sample.error === null),
    summary: cases.map((probe) => ({
      case: probe.name,
      ...summarize(samples.filter((sample) => sample.case === probe.name)),
    })),
    samples,
  };
}
