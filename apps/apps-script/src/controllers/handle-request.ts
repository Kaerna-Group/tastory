import { API_VERSION, SCHEMA_VERSION, apiRequestSchema } from '@tastory/contracts';
import type {
  ApiErrorResponse,
  EchoResponse,
  HealthResponse,
  AuthData,
  AuthResponse,
} from '@tastory/contracts';
import { AuthError } from '../auth/google-token';

export type RequestContext = Readonly<{
  now: () => Date;
  createRequestId: () => string;
  isEchoEnabled: boolean;
  deploymentVersion: string;
  isAuthConfigured?: boolean;
  authenticate?: (credential: string, allowJoin: boolean) => AuthData;
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
): HealthResponse | EchoResponse | AuthResponse {
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
        auth: context.isAuthConfigured ? 'staging' : 'not-configured',
      },
      meta,
    };
  }
  if (request.action === 'auth.signIn' || request.action === 'auth.me') {
    try {
      if (!context.authenticate) throw new AuthError('AUTH_NOT_CONFIGURED');
      const data = context.authenticate(request.credential, request.action === 'auth.signIn');
      return { ok: true, requestId: request.requestId, data, meta };
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'AUTH_UNAVAILABLE';
      const messages = {
        AUTH_NOT_CONFIGURED: 'Вход Google ещё настраивается.',
        UNAUTHENTICATED: 'Войдите в Google повторно.',
        ACCESS_DENIED: 'Доступ не разрешён. Обратитесь к владельцу тетради.',
        AUTH_UNAVAILABLE: 'Не удалось проверить вход. Попробуйте позже.',
      };
      return { ok: false, requestId: request.requestId, error: { code, message: messages[code] } };
    }
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
): HealthResponse | EchoResponse | AuthResponse {
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
