import {
  API_VERSION,
  SCHEMA_VERSION,
  PHOTO_BODY_LIMIT,
  apiRequestSchema,
  adminUsersResponseSchema,
  adminHealthResponseSchema,
  journalResponseSchema,
  accessResponseSchema,
  accessCommandSchema,
  recipeCommandSchema,
  recipeResponseSchema,
  RECIPE_BODY_LIMIT,
  backupCommandSchema,
  backupResponseSchema,
  userSettingsCommandSchema,
  userSettingsResponseSchema,
  stickerCommandSchema,
  stickerResponseSchema,
  templateCommandSchema,
  templateResponseSchema,
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
  AccessCommand,
  AccessData,
  AccessResponse,
  RecipeCommand,
  RecipeData,
  RecipeResponse,
  BackupCommand,
  BackupData,
  BackupResponse,
  UserSettingsCommand,
  UserSettingsData,
  UserSettingsResponse,
  StickerCommand,
  StickerData,
  StickerResponse,
  TemplateCommand,
  TemplateData,
  TemplateResponse,
} from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { PhotoError } from '../services/photo-error';
import { ProbeError } from '../services/concurrency-probe';
import { AdminError } from '../services/admin-directory';
import { JournalError } from '../services/journal-error';
import { AccessError } from '../services/access-model';
import { RecipeModelError } from '../services/recipe-model';
import { RecipeStorageError } from '../services/recipe-storage';
import { BackupError } from '../services/book-backup';
import { FileLifecycleError } from '../services/file-lifecycle';
import { UserSettingsError } from '../services/user-settings';
import { StickerStorageError } from '../services/sticker-storage';
import { TemplateStorageError } from '../services/template-storage';

export type RequestContext = Readonly<{
  now: () => Date;
  createRequestId: () => string;
  isEchoEnabled: boolean;
  deploymentVersion: string;
  authEnvironment?: 'staging' | 'production';
  admitRequest?: (action: string, credential: string) => boolean;
  authenticate?: (credential: string, allowJoin: boolean) => AuthData;
  photo?: (command: PhotoCommand, session: AuthData) => PhotoData;
  concurrency?: (command: ConcurrencyCommand, session: AuthData) => ConcurrencyData;
  admin?: (action: AdminAction, session: AuthData) => AdminUsersData | AdminHealthData;
  journal?: (action: JournalAction, requestId: string, session: AuthData) => JournalData;
  access?: (command: AccessCommand, requestId: string, session: AuthData) => AccessData;
  recipes?: (command: RecipeCommand, requestId: string, session: AuthData) => RecipeData;
  backups?: (command: BackupCommand, requestId: string, session: AuthData) => BackupData;
  settings?: (
    command: UserSettingsCommand,
    requestId: string,
    session: AuthData,
  ) => UserSettingsData;
  stickers?: (command: StickerCommand, requestId: string, session: AuthData) => StickerData;
  templates?: (command: TemplateCommand, requestId: string, session: AuthData) => TemplateData;
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
  | JournalResponse
  | AccessResponse
  | RecipeResponse
  | BackupResponse
  | UserSettingsResponse
  | StickerResponse
  | TemplateResponse {
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
        auth: context.authEnvironment ?? 'not-configured',
      },
      meta,
    };
  }
  if ('credential' in request) {
    try {
      if (context.admitRequest && !context.admitRequest(request.action, request.credential))
        return {
          ok: false,
          requestId: request.requestId,
          error: {
            code: 'RATE_LIMITED',
            message: 'Слишком много запросов. Подождите минуту и повторите попытку.',
          },
        };
      if (!context.authenticate) throw new AuthError('AUTH_NOT_CONFIGURED');
      const session = context.authenticate(request.credential, request.action === 'auth.signIn');
      if (request.action === 'auth.signIn' || request.action === 'auth.me')
        return { ok: true, requestId: request.requestId, data: session, meta };
      if (request.action === 'user.settings.get' || request.action === 'user.settings.update') {
        if (!context.settings) throw new UserSettingsError('SETTINGS_NOT_READY');
        return userSettingsResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.settings(
            userSettingsCommandSchema.parse({ action: request.action, payload: request.payload }),
            request.requestId,
            session,
          ),
          meta,
        });
      }
      if (
        request.action.startsWith('stickers.') ||
        request.action.startsWith('recipes.stickers.')
      ) {
        if (!context.stickers) throw new StickerStorageError('STICKER_NOT_READY');
        return stickerResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.stickers(
            stickerCommandSchema.parse({ action: request.action, payload: request.payload }),
            request.requestId,
            session,
          ),
          meta,
        });
      }
      if (
        request.action.startsWith('templates.') ||
        request.action.startsWith('recipes.template.')
      ) {
        if (!context.templates) throw new TemplateStorageError('TEMPLATE_NOT_READY');
        return templateResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.templates(
            templateCommandSchema.parse({ action: request.action, payload: request.payload }),
            request.requestId,
            session,
          ),
          meta,
        });
      }
      if (
        request.action === 'admin.backups.list' ||
        request.action === 'admin.backups.create' ||
        request.action === 'admin.backups.verify' ||
        request.action === 'admin.backups.restore'
      ) {
        if (!context.backups) throw new BackupError();
        return backupResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.backups(
            backupCommandSchema.parse({ action: request.action, payload: request.payload }),
            request.requestId,
            session,
          ),
          meta,
        });
      }
      if (
        request.action === 'recipes.list' ||
        request.action === 'admin.files.audit' ||
        request.action === 'admin.files.trash' ||
        request.action === 'admin.files.trashUnused' ||
        request.action === 'admin.files.restore' ||
        request.action === 'admin.files.cleanup' ||
        request.action === 'recipes.favorite.set' ||
        request.action === 'recipes.history' ||
        request.action === 'recipes.version' ||
        request.action === 'recipes.version.restore' ||
        request.action === 'admin.recipes.archiveHistory' ||
        request.action === 'recipes.get' ||
        request.action === 'recipes.create' ||
        request.action === 'recipes.updateContent' ||
        request.action === 'recipes.archive' ||
        request.action === 'recipes.restore' ||
        request.action === 'recipes.photos.add' ||
        request.action === 'recipes.photos.delete' ||
        request.action === 'recipes.photos.read' ||
        request.action === 'tags.list' ||
        request.action === 'tags.create' ||
        request.action === 'recipes.operations.list' ||
        request.action === 'recipes.operations.resume' ||
        request.action === 'recipes.operations.cancel' ||
        request.action === 'admin.recipes.initialize'
      ) {
        if (!context.recipes) throw new RecipeStorageError('RECIPE_NOT_READY');
        return recipeResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.recipes(
            recipeCommandSchema.parse({ action: request.action, payload: request.payload }),
            request.requestId,
            session,
          ),
          meta,
        });
      }
      if (session.user.role !== 'owner') throw new AuthError('ACCESS_DENIED');
      if (
        request.action === 'admin.access.list' ||
        request.action === 'admin.access.resume' ||
        request.action === 'admin.invites.create' ||
        request.action === 'admin.invites.revoke' ||
        request.action === 'admin.members.update'
      ) {
        if (!context.access) throw new AccessError();
        return accessResponseSchema.parse({
          ok: true,
          requestId: request.requestId,
          data: context.access(
            accessCommandSchema.parse({ action: request.action, payload: request.payload }),
            request.requestId,
            session,
          ),
          meta,
        });
      }
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
        data: context.photo(request as PhotoCommand, session),
        meta,
      };
    } catch (error) {
      const code =
        error instanceof AuthError ||
        error instanceof PhotoError ||
        error instanceof ProbeError ||
        error instanceof AdminError ||
        error instanceof JournalError ||
        error instanceof AccessError ||
        error instanceof RecipeModelError ||
        error instanceof RecipeStorageError ||
        error instanceof FileLifecycleError ||
        error instanceof BackupError ||
        error instanceof UserSettingsError ||
        error instanceof StickerStorageError ||
        error instanceof TemplateStorageError
          ? error.code
          : request.action.startsWith('templates.') ||
              request.action.startsWith('recipes.template.')
            ? 'TEMPLATE_UNAVAILABLE'
            : request.action.startsWith('stickers.') ||
                request.action.startsWith('recipes.stickers.')
              ? 'STICKER_UNAVAILABLE'
              : request.action.startsWith('recipes.') ||
                  request.action.startsWith('tags.') ||
                  request.action === 'admin.recipes.initialize' ||
                  request.action.startsWith('admin.files.')
                ? 'RECIPE_UNAVAILABLE'
                : request.action.startsWith('user.settings.')
                  ? 'SETTINGS_UNAVAILABLE'
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
        ACCESS_CONFLICT: 'Доступ уже изменился. Обновите список и выберите изменение заново.',
        ACCESS_PENDING: 'Сначала завершите прерванное изменение в разделе управления доступом.',
        ACCESS_LIMIT: 'Достигнут лимит участников или приглашений.',
        ACCESS_INVALID: 'Изменение недоступно: проверьте участника или действующее приглашение.',
        ACCESS_UNAVAILABLE:
          'Изменение не подтверждено. Повторите тот же запрос или откройте управление доступом.',
        RECIPE_NOT_READY: 'Владелец должен подготовить хранилище рецептов.',
        RECIPE_INVALID: 'Проверьте содержание рецепта и его связи.',
        RECIPE_UNAVAILABLE:
          'Сохранение не подтверждено. Повторите запрос с тем же идентификатором.',
        RECIPE_CONFLICT: 'Данные уже изменились. Обновите рецепт перед сохранением.',
        RECIPE_PENDING:
          'Есть незавершённая запись. Повторите исходный запрос, продолжите или отмените её.',
        RECIPE_LIMIT: 'Достигнут лимит хранилища. Сохранённые рецепты доступны для чтения.',
        RECIPE_CANCELLED: 'Эта запись отменена. Для нового сохранения создайте новый запрос.',
        BACKUP_UNAVAILABLE: 'Копирование не подтверждено. Повторите тот же запрос.',
        BACKUP_INVALID: 'Проверка целостности копии не пройдена. Исходная книга сохранена.',
        BACKUP_PENDING:
          'Сначала завершите или отмените незавершённые операции, затем создайте копию.',
        BACKUP_LIMIT: 'Достигнут лимит резервного копирования. Обратитесь к владельцу.',
        FILE_UNAVAILABLE: 'Не удалось проверить файлы книги. Повторите сканирование.',
        FILE_CONFLICT: 'Состояние файла изменилось. Обновите отчёт перед действием.',
        FILE_LIMIT: 'В папке слишком много файлов для безопасной автоматической проверки.',
        SETTINGS_NOT_READY: 'Владелец должен подготовить хранение настроек.',
        SETTINGS_CONFLICT: 'Настройки уже изменились. Обновите страницу и повторите.',
        SETTINGS_UNAVAILABLE: 'Не удалось сохранить настройки. Повторите тот же запрос.',
        STICKER_NOT_READY: 'Владелец должен подготовить хранилище стикеров.',
        STICKER_INVALID: 'Файл стикера повреждён или имеет неподдерживаемый формат.',
        STICKER_UNAVAILABLE: 'Изменение стикеров не подтверждено. Повторите тот же запрос.',
        STICKER_CONFLICT: 'Пак или размещение уже изменились. Обновите список.',
        STICKER_LIMIT: 'Достигнут лимит паков или стикеров.',
        TEMPLATE_NOT_READY: 'Владелец должен подготовить библиотеку шаблонов.',
        TEMPLATE_INVALID: 'Шаблон повреждён, архивирован или больше недоступен.',
        TEMPLATE_UNAVAILABLE: 'Изменение шаблона не подтверждено. Повторите тот же запрос.',
        TEMPLATE_CONFLICT: 'Шаблон или оформление рецепта уже изменились. Обновите библиотеку.',
        TEMPLATE_LIMIT: 'Достигнут лимит личных шаблонов.',
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
  | JournalResponse
  | AccessResponse
  | RecipeResponse
  | BackupResponse
  | UserSettingsResponse
  | StickerResponse
  | TemplateResponse {
  if (body.length > Math.max(PHOTO_BODY_LIMIT, RECIPE_BODY_LIMIT)) return invalidRequest(context);
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return invalidRequest(context);
  }
  const action =
    typeof input === 'object' && input !== null && 'action' in input ? input.action : '';
  const limit =
    action === 'spike.photo.upload'
      ? PHOTO_BODY_LIMIT
      : action === 'recipes.create' ||
          action === 'recipes.updateContent' ||
          action === 'recipes.photos.add' ||
          action === 'stickers.items.add'
        ? RECIPE_BODY_LIMIT
        : 8192;
  if (body.length > limit) return invalidRequest(context);
  return handleRequest(input, context);
}
