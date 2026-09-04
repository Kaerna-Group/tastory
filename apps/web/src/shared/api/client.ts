import {
  API_VERSION,
  healthResponseSchema,
  authResponseSchema,
  photoResponseSchema,
  concurrencyResponseSchema,
  adminUsersResponseSchema,
  adminHealthResponseSchema,
  journalResponseSchema,
  accessResponseSchema,
  recipeResponseSchema,
  backupResponseSchema,
  userSettingsResponseSchema,
  stickerResponseSchema,
  templateResponseSchema,
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
  JournalAction,
  JournalData,
  AccessCommand,
  AccessData,
  RecipeCommand,
  RecipeData,
  BackupCommand,
  BackupData,
  UserSettingsCommand,
  UserSettingsData,
  StickerCommand,
  StickerData,
  TemplateCommand,
  TemplateData,
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
  settings: (
    command: UserSettingsCommand,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<UserSettingsData>;
  backups: (
    command: BackupCommand,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<BackupData>;
  recipes: (
    command: RecipeCommand,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<RecipeData>;
  stickers: (
    command: StickerCommand,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<StickerData>;
  templates: (
    command: TemplateCommand,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<TemplateData>;
  access: (
    command: AccessCommand,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<AccessData>;
  journal: (
    action: JournalAction,
    credential: string,
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<JournalData>;
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
    async settings(command, credential, requestId, signal) {
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = userSettingsResponseSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (parsed.data.data.kind !== 'userSettings' ||
            (command.action === 'user.settings.get'
              ? parsed.data.data.outcome !== 'read'
              : parsed.data.data.outcome === 'read')))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async backups(command, credential, requestId, signal) {
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = backupResponseSchema.safeParse(raw);
      const expectedKind =
        command.action === 'admin.backups.list'
          ? 'backups'
          : command.action === 'admin.backups.restore'
            ? 'restored'
            : 'backup';
      const backupId =
        command.action === 'admin.backups.create'
          ? requestId
          : 'backupId' in command.payload
            ? command.payload.backupId
            : null;
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (parsed.data.data.kind !== expectedKind ||
            (parsed.data.data.kind !== 'backups' && parsed.data.data.backup.id !== backupId)))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async recipes(command, credential, requestId, signal) {
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = recipeResponseSchema.safeParse(raw);
      const expectedKind = {
        'recipes.history': 'history',
        'admin.files.audit': 'files',
        'admin.files.trash': 'files',
        'admin.files.trashUnused': 'files',
        'admin.files.restore': 'files',
        'admin.files.cleanup': 'files',
        'recipes.version': 'recipe',
        'recipes.version.restore': 'saved',
        'admin.recipes.archiveHistory': 'archivedHistory',
        'recipes.list': 'recipes',
        'recipes.favorite.set': 'favorite',
        'recipes.get': 'recipe',
        'recipes.photos.read': 'photo',
        'tags.list': 'tags',
        'recipes.operations.list': 'operations',
        'admin.recipes.initialize': 'initialized',
        'recipes.create': 'saved',
        'recipes.updateContent': 'saved',
        'recipes.archive': 'saved',
        'recipes.restore': 'saved',
        'recipes.photos.add': 'saved',
        'recipes.photos.delete': 'saved',
        'tags.create': 'saved',
        'recipes.operations.resume': 'saved',
        'recipes.operations.cancel': 'saved',
      }[command.action];
      const operationId =
        command.action === 'recipes.operations.resume' ||
        command.action === 'recipes.operations.cancel'
          ? command.payload.operationId
          : requestId;
      const expectedEntityType =
        command.action === 'tags.create'
          ? 'tag'
          : [
                'recipes.create',
                'recipes.updateContent',
                'recipes.archive',
                'recipes.restore',
                'recipes.version.restore',
                'recipes.photos.add',
                'recipes.photos.delete',
              ].includes(command.action)
            ? 'recipe'
            : null;
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (parsed.data.data.kind !== expectedKind ||
            (parsed.data.data.kind === 'saved' &&
              (parsed.data.data.operationId !== operationId ||
                (expectedEntityType !== null &&
                  parsed.data.data.entityType !== expectedEntityType) ||
                (command.action === 'recipes.operations.cancel'
                  ? parsed.data.data.outcome !== 'cancelled'
                  : parsed.data.data.outcome === 'cancelled') ||
                ((command.action === 'recipes.updateContent' ||
                  command.action === 'recipes.archive' ||
                  command.action === 'recipes.restore' ||
                  command.action === 'recipes.version.restore' ||
                  command.action === 'recipes.photos.add' ||
                  command.action === 'recipes.photos.delete') &&
                  parsed.data.data.entityId !== command.payload.recipeId))) ||
            (parsed.data.data.kind === 'recipe' &&
              (command.action === 'recipes.get' || command.action === 'recipes.version') &&
              (parsed.data.data.aggregate.recipe.id !== command.payload.recipeId ||
                (command.action === 'recipes.version' &&
                  parsed.data.data.aggregate.recipe.revision !== command.payload.revision))) ||
            (parsed.data.data.kind === 'history' &&
              command.action === 'recipes.history' &&
              parsed.data.data.recipeId !== command.payload.recipeId) ||
            (parsed.data.data.kind === 'favorite' &&
              command.action === 'recipes.favorite.set' &&
              (parsed.data.data.recipeId !== command.payload.recipeId ||
                parsed.data.data.favorite !== command.payload.favorite)) ||
            (parsed.data.data.kind === 'photo' &&
              command.action === 'recipes.photos.read' &&
              (parsed.data.data.photo.id !== command.payload.photoId ||
                parsed.data.data.photo.recipeId !== command.payload.recipeId ||
                parsed.data.data.variant !== command.payload.variant))))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async stickers(command, credential, requestId, signal) {
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = stickerResponseSchema.safeParse(raw);
      const expectedKind = {
        'stickers.packs.list': 'stickerPacks',
        'stickers.packs.create': 'stickerPack',
        'stickers.packs.update': 'stickerPack',
        'stickers.packs.archive': 'stickerPack',
        'stickers.packs.restore': 'stickerPack',
        'stickers.items.add': 'stickerPack',
        'stickers.items.reorder': 'stickerPack',
        'stickers.items.archive': 'stickerPack',
        'stickers.assets.read': 'stickerAsset',
        'recipes.stickers.list': 'recipeStickers',
        'recipes.stickers.add': 'recipeSticker',
        'recipes.stickers.update': 'recipeSticker',
        'recipes.stickers.delete': 'recipeSticker',
      }[command.action];
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (parsed.data.data.kind !== expectedKind ||
            (parsed.data.data.kind === 'recipeStickers' &&
              command.action === 'recipes.stickers.list' &&
              parsed.data.data.recipeId !== command.payload.recipeId) ||
            (parsed.data.data.kind === 'recipeSticker' &&
              command.action.startsWith('recipes.stickers.') &&
              parsed.data.data.recipeId !== (command.payload as { recipeId: string }).recipeId)))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async templates(command, credential, requestId, signal) {
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = templateResponseSchema.safeParse(raw);
      const expectedKind = {
        'templates.list': 'templateLibrary',
        'templates.create': 'template',
        'templates.update': 'template',
        'templates.archive': 'template',
        'templates.restore': 'template',
        'templates.clone': 'template',
        'recipes.template.get': 'recipeTemplate',
        'recipes.template.apply': 'recipeTemplate',
      }[command.action];
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (parsed.data.data.kind !== expectedKind ||
            (parsed.data.data.kind === 'recipeTemplate' &&
              command.action.startsWith('recipes.template.') &&
              (parsed.data.data.recipeId !== (command.payload as { recipeId: string }).recipeId ||
                (command.action === 'recipes.template.get'
                  ? parsed.data.data.outcome !== 'read'
                  : parsed.data.data.outcome === 'read')))))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async access(command, credential, requestId, signal) {
      const raw = await transport(
        { ...command, apiVersion: API_VERSION, requestId, credential },
        signal,
      );
      const parsed = accessResponseSchema.safeParse(raw);
      const operationId =
        command.action === 'admin.access.resume' ? command.payload.operationId : requestId;
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (command.action === 'admin.access.list'
            ? parsed.data.data.kind !== 'access'
            : parsed.data.data.kind !== 'saved' || parsed.data.data.operationId !== operationId))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
    async journal(action, credential, requestId, signal) {
      const raw = await transport(
        { apiVersion: API_VERSION, requestId, action, credential, payload: {} },
        signal,
      );
      const parsed = journalResponseSchema.safeParse(raw);
      const kind = {
        'admin.operations.list': 'list',
        'admin.operations.initialize': 'initialized',
        'admin.operations.check': 'check',
      }[action];
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        (parsed.data.ok &&
          (parsed.data.data.kind !== kind ||
            (parsed.data.data.kind === 'check' && parsed.data.data.entry.id !== requestId)))
      )
        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Сервер вернул несовместимый ответ.',
          requestId,
        );
      if (!parsed.data.ok)
        throw new ApiClientError(parsed.data.error.code, parsed.data.error.message, requestId);
      return parsed.data.data;
    },
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
        request.action.startsWith('spike.') ||
          request.action.startsWith('admin.') ||
          request.action.startsWith('auth.') ||
          request.action.startsWith('recipes.') ||
          request.action.startsWith('tags.') ||
          request.action.startsWith('stickers.') ||
          request.action.startsWith('templates.')
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
