import { API_VERSION, healthResponseSchema, authResponseSchema } from '@tastory/contracts';
import type { ApiRequest, HealthData, AuthData, ApiErrorResponse } from '@tastory/contracts';

export type ApiTransport = (request: ApiRequest, signal?: AbortSignal) => Promise<unknown>;

export class ApiClientError extends Error {
  constructor(
    public readonly code:
      'TRANSPORT_ERROR' | 'INVALID_RESPONSE' | ApiErrorResponse['error']['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function createApiClient(
  transport: ApiTransport,
  createRequestId: () => string = () => crypto.randomUUID(),
): {
  health: (signal?: AbortSignal) => Promise<HealthData>;
  authenticate: (
    credential: string,
    action?: 'auth.signIn' | 'auth.me',
    signal?: AbortSignal,
  ) => Promise<AuthData>;
} {
  return {
    async authenticate(credential, action = 'auth.signIn', signal) {
      const requestId = createRequestId();
      const raw = await transport(
        { apiVersion: API_VERSION, requestId, action, credential, payload: {} },
        signal,
      );
      const parsed = authResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId)
        throw new ApiClientError('INVALID_RESPONSE', 'Сервер вернул несовместимый ответ.');
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message);
      if (Date.parse(parsed.data.data.expiresAt) <= Date.now())
        throw new ApiClientError('UNAUTHENTICATED', 'Войдите в Google повторно.');
      return parsed.data.data;
    },
    async health(signal) {
      const requestId = createRequestId();
      const raw = await transport(
        { apiVersion: API_VERSION, requestId, action: 'health', payload: {} },
        signal,
      );
      const parsed = healthResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId)
        throw new ApiClientError('INVALID_RESPONSE', 'Сервер вернул несовместимый ответ.');
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message);
      return parsed.data.data;
    },
  };
}

export function createHttpTransport(url: string, fetcher: typeof fetch = fetch): ApiTransport {
  return async (request, signal) => {
    try {
      const timeout = AbortSignal.timeout(15_000);
      const response = await fetcher(url, {
        method: 'POST',
        // Apps Script не обрабатывает произвольный preflight. Реальный CORS проверяется на этапе 0.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(request),
        credentials: 'omit',
        redirect: 'follow',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error('HTTP request failed');
      const data: unknown = await response.json();
      return data;
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw new ApiClientError(
        'TRANSPORT_ERROR',
        'Не удалось связаться с сервером. Повторите проверку.',
      );
    }
  };
}
