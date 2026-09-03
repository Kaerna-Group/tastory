import {
  API_VERSION,
  SCHEMA_VERSION,
  PHOTO_BODY_LIMIT,
  apiRequestSchema,
  adminUsersResponseSchema,
  adminHealthResponseSchema,
  journalResponseSchema,
} from '@tastory/contracts';
import type {
  ApiErrorResponse,
  EchoResponse,
  HealthResponse,
  AuthData,
  AuthResponse,
  PhotoCommand,
  PhotoData,
  PhotoResponse,
  ConcurrencyCommand,
  ConcurrencyData,
  ConcurrencyResponse,
  AdminAction,
  AdminUsersData,
  AdminHealthData,
  AdminResponse,
  JournalResponse,
  JournalAction,
  JournalData,
} from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { PhotoError } from '../services/photo-error';
import { ProbeError } from '../services/concurrency-probe';
import { AdminError } from '../services/admin-directory';
import { JournalError } from '../services/journal-error';

export type RequestContext = Readonly<{
  now: () => Date;
  createRequestId: () => string;
  isEchoEnabled: boolean;
  deploymentVersion: string;
  isAuthConfigured?: boolean;
  authenticate?: (credential: string, allowJoin: boolean) => AuthData;
  photo?: (command: PhotoCommand, session: AuthData) => PhotoData;
  concurrency?: (command: ConcurrencyCommand, session: AuthData) => ConcurrencyData;
  admin?: (action: AdminAction, session: AuthData) => AdminUsersData | AdminHealthData;
  journal?: (action: JournalAction, requestId: string, session: AuthData) => JournalData;
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
):
  | HealthResponse
  | EchoResponse
  | AuthResponse
  | PhotoResponse
  | ConcurrencyResponse
  | AdminResponse
  | JournalResponse {
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
  if ('credential' in request) {
    try {
      if (!context.authenticate) throw new AuthError('AUTH_NOT_CONFIGURED');
      const session = context.authenticate(request.credential, request.action === 'auth.signIn');
      if (request.action === 'auth.signIn' || request.action === 'auth.me')
        return { ok: true, requestId: request.requestId, data: session, meta };
      if (session.user.role !== 'owner') throw new AuthError('ACCESS_DENIED');
      if (
        request.action === 'admin.operations.list' ||
        request.action === 'admin.operations.initialize' ||
        request.action === 'admin.operations.check'
      ) {
        if (!context.journal) throw new JournalError();
        return journalResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.journal(request.action, request.requestId, session),
          meta,
        });
      }
      if (request.action === 'admin.users.list' || request.action === 'admin.health') {
        if (!context.admin) throw new AdminError();
        const response = {
          ok: true,
          requestId: request.requestId,
          data: context.admin(request.action, session),
          meta,
        };
        return request.action === 'admin.users.list'
          ? adminUsersResponseSchema.parse(response)
          : adminHealthResponseSchema.parse(response);
      }
      if (
        request.action === 'spike.concurrency.read' ||
        request.action === 'spike.concurrency.write'
      ) {
        if (!context.concurrency) throw new ProbeError('PROBE_UNAVAILABLE');
        return {
          ok: true,
          requestId: request.requestId,
          data: context.concurrency(request, session),
          meta,
        };
      }
      if (!context.photo) throw new PhotoError('PHOTO_UNAVAILABLE');
      return {
        ok: true,
        requestId: request.requestId,
        data: context.photo(request, session),
        meta,
      };
    } catch (error) {
      const code =
        error instanceof AuthError ||
        error instanceof PhotoError ||
        error instanceof ProbeError ||
        error instanceof AdminError ||
        error instanceof JournalError
          ? error.code
          : 'AUTH_UNAVAILABLE';
      const messages = {
        AUTH_NOT_CONFIGURED: 'Вход Google ещё настраивается.',
        UNAUTHENTICATED: 'Войдите в Google повторно.',
        ACCESS_DENIED: 'Доступ не разрешён. Обратитесь к владельцу тетради.',
        AUTH_UNAVAILABLE: 'Не удалось проверить вход. Попробуйте позже.',
        PHOTO_INVALID: 'Не удалось прочитать фото. Выберите другое изображение.',
        PHOTO_EXISTS:
          'Тестовое фото уже сохранено. Обновите просмотр или удалите его перед новой загрузкой.',
        PHOTO_UNAVAILABLE:
          'Хранилище фото не ответило. Обновите просмотр перед повторной загрузкой.',
        PHOTO_NOT_PRIVATE:
          'Папка или файл доступны другим людям. Владелец должен проверить доступ в Google Drive.',
        PROBE_UNAVAILABLE:
          'Проверка записи не завершилась. Сохраните результат и попробуйте позже.',
        PROBE_LIMIT:
          'Достигнут лимит тестовых запусков. Сохраните результаты и обратитесь к владельцу.',
        OPERATION_MISMATCH: 'Повторный запрос отличается от исходного. Начните новую проверку.',
        ADMIN_UNAVAILABLE: 'Не удалось прочитать данные тетради. Попробуйте позже.',
        JOURNAL_NOT_READY: 'Сначала подготовьте журнал операций.',
        JOURNAL_UNAVAILABLE: 'Журнал не ответил. Обновите список или повторите ту же проверку.',
        JOURNAL_LIMIT: 'Журнал заполнен. Существующие записи сохранены; обратитесь к владельцу.',
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
):
  | HealthResponse
  | EchoResponse
  | AuthResponse
  | PhotoResponse
  | ConcurrencyResponse
  | AdminResponse
  | JournalResponse {
  if (body.length > PHOTO_BODY_LIMIT) return invalidRequest(context);
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return invalidRequest(context);
  }
  if (
    body.length > 8192 &&
    (typeof input !== 'object' ||
      input === null ||
      !('action' in input) ||
      input.action !== 'spike.photo.upload')
  )
    return invalidRequest(context);
  return handleRequest(input, context);
}
