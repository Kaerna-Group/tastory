import { API_VERSION, SCHEMA_VERSION, apiRequestSchema } from '@tastory/contracts';
import type { ApiErrorResponse, EchoResponse, HealthResponse } from '@tastory/contracts';

export type RequestContext = Readonly<{
  now: () => Date;
  createRequestId: () => string;
  isEchoEnabled: boolean;
  deploymentVersion: string;
}>;

function invalidRequest(context: RequestContext): ApiErrorResponse {
  return {
    ok: false,
    requestId: context.createRequestId(),
    error: { code: 'INVALID_REQUEST', message: 'Некорректный запрос API v1.' },
  };
}

export function handleRequest(
  input: unknown,
  context: RequestContext,
): HealthResponse | EchoResponse {
  const parsed = apiRequestSchema.safeParse(input);
  if (!parsed.success) return invalidRequest(context);
  const request = parsed.data;
  const meta = { apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION } as const;

  if (request.action === 'health') {
    return {
      ok: true,
      requestId: request.requestId,
      data: {
        status: 'ok',
        service: 'tastory-api',
        deploymentVersion: context.deploymentVersion,
        timestamp: context.now().toISOString(),
        storage: 'not-configured',
        auth: 'not-configured',
      },
      meta,
    };
  }
  if (!context.isEchoEnabled) {
    return {
      ok: false,
      requestId: request.requestId,
      error: { code: 'ACTION_DISABLED', message: 'Echo отключен для этого окружения.' },
    };
  }
  return { ok: true, requestId: request.requestId, data: request.payload, meta };
}

export function handlePostBody(
  body: string,
  context: RequestContext,
): HealthResponse | EchoResponse {
  // Ограничение до JSON.parse защищает диагностический endpoint от крупных payload.
  if (body.length > 8192) return invalidRequest(context);
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return invalidRequest(context);
  }
  return handleRequest(input, context);
}
