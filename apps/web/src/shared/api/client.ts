import {
  API_VERSION,
  healthResponseSchema,
  authResponseSchema,
  photoResponseSchema,
  concurrencyResponseSchema,
  adminUsersResponseSchema,
  adminHealthResponseSchema,
} from '@tastory/contracts';
import type {
  ApiRequest,
  HealthData,
  AuthData,
  ApiErrorResponse,
  PhotoCommand,
  PhotoData,
  ConcurrencyCommand,
  ConcurrencyData,
  AdminUsersData,
  AdminHealthData,
} from '@tastory/contracts';

export type ApiTransport = (request: ApiRequest, signal?: AbortSignal) => Promise<unknown>;
export type AuthResult = AuthData & { requestId: string };

export class ApiClientError extends Error {
  constructor(
    public readonly code:
      'TRANSPORT_ERROR' | 'INVALID_RESPONSE' | ApiErrorResponse['error']['code'],
    message: string,
    public readonly requestId: string | null = null,
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
  adminUsers: (credential: string, signal?: AbortSignal) => Promise<AdminUsersData>;
  adminHealth: (credential: string, signal?: AbortSignal) => Promise<AdminHealthData>;
  photo: (command: PhotoCommand, credential: string, signal?: AbortSignal) => Promise<PhotoData>;
  concurrency: (
    command: ConcurrencyCommand,
    credential: string,
    signal?: AbortSignal,
  ) => Promise<ConcurrencyData>;
  authenticate: (
    credential: string,
    action?: 'auth.signIn' | 'auth.me',
    signal?: AbortSignal,
  ) => Promise<AuthResult>;
} {
  return {
    async adminUsers(credential, signal) {
      const requestId = createRequestId();
      const raw = await transport(
        { apiVersion: API_VERSION, requestId, action: 'admin.users.list', credential, payload: {} },
        signal,
      );
      const parsed = adminUsersResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId)
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async adminHealth(credential, signal) {
      const requestId = createRequestId();
      const raw = await transport(
        { apiVersion: API_VERSION, requestId, action: 'admin.health', credential, payload: {} },
        signal,
      );
      const parsed = adminHealthResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId)
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async concurrency(command, credential, signal) {
      const requestId = createRequestId();
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = concurrencyResponseSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok && parsed.data.data.state.runId !== command.payload.runId)
      )
        throw new ApiClientError('INVALID_RESPONSE', 'Сервер вернул несовместимый ответ.');
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message);
      return parsed.data.data;
    },
    async photo(command, credential, signal) {
      const requestId = createRequestId();
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = photoResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId)
        throw new ApiClientError('INVALID_RESPONSE', 'Сервер вернул несовместимый ответ.');
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message);
      return parsed.data.data;
    },
    async authenticate(credential, action = 'auth.signIn', signal) {
      const requestId = createRequestId();
      try {
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
        return { ...parsed.data.data, requestId };
      } catch (error) {
        if (error instanceof ApiClientError)
          throw new ApiClientError(error.code, error.message, requestId);
        throw error;
      }
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
      const timeout = AbortSignal.timeout(
        request.action.startsWith('spike.') || request.action.startsWith('admin.')
          ? 60_000
          : 15_000,
      );
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
