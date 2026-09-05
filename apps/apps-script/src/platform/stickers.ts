import {
  BUILTIN_STICKER_PACKS,
  STICKER_LIMITS,
  normalizeStickerName,
  recipeStickerSchema,
  stickerCommandSchema,
  stickerItemSchema,
  stickerPackSchema,
} from '@tastory/contracts';
import type {
  AuthData,
  RecipeSticker,
  StickerCommand,
  StickerData,
  StickerItem,
  StickerPack,
  StickerPackView,
} from '@tastory/contracts';
import { canAccessRecipe, canManageStickerPack, canReadStickerPack } from '@tastory/domain';
import { AuthError } from '../auth/google-token';
import { resolveWorkspaceAccess, sheetsAuthConfigSchema } from '../auth/workspace-access';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { createRecipeStore } from './recipe-store';
import { createRecipeReader } from '../services/recipe-reader';
import { readRecipeAggregate } from '../services/recipe-model';
import { planRecipeSchema } from '../services/recipe-migration';
import { canonicalRecipeJson } from '../services/recipe-storage';
import {
  StickerStorageError,
  publishStickerMutation,
  readStickerState,
} from '../services/sticker-storage';
import type { StickerOperation } from '../services/sticker-storage';
import { ensureStickerAsset, readStickerAsset } from './sticker-assets';
import { journalMigrationOptions, sha256 } from './current-schema';
import { runtimeEnvironment } from './runtime-environment';

type Actor = { userId: string; workspaceId: string; role: 'owner' | 'member' | 'viewer' };
const stripVersion = <T extends { versionId: string }>(value: T): Omit<T, 'versionId'> => {
  const { versionId, ...rest } = value;
  void versionId;
  return rest;
};

const canReadPack = canReadStickerPack;
const canManagePack = canManageStickerPack;

function customPacks(store: ReturnType<typeof createRecipeStore>) {
  const state = readStickerState(store);
  return {
    state,
    packs: [...state.packs.values()].map((row) => stickerPackSchema.parse(stripVersion(row))),
    stickers: [...state.stickers.values()].map((row) => stickerItemSchema.parse(stripVersion(row))),
    placements: [...state.placements.values()].map((row) =>
      recipeStickerSchema.parse({ ...stripVersion(row), pageId: `page-${row.page}` }),
    ),
  };
}
function allPacks(store: ReturnType<typeof createRecipeStore>) {
  const custom = customPacks(store);
  return {
    ...custom,
    packs: [...BUILTIN_STICKER_PACKS.map((item) => item.pack), ...custom.packs],
    stickers: [...BUILTIN_STICKER_PACKS.flatMap((item) => item.stickers), ...custom.stickers],
  };
}
function packView(actor: Actor, pack: StickerPack, stickers: StickerItem[]): StickerPackView {
  return {
    pack,
    stickers: stickers
      .filter((item) => item.packId === pack.id && item.status === 'active')
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ru')),
    canManage: canManagePack(actor, pack),
  };
}
function requirePack(actor: Actor, packs: StickerPack[], id: string, manage = false) {
  const pack = packs.find((item) => item.id === id);
  if (!pack || (manage ? !canManagePack(actor, pack) : !canReadPack(actor, pack)))
    throw new AuthError('ACCESS_DENIED');
  return pack;
}
function operation(
  command: StickerCommand,
  requestId: string,
  entityId: string,
  actor: Actor,
  now: () => Date,
) {
  return {
    requestId,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: command.action as StickerOperation['action'],
    entityId,
    payloadHash: sha256(canonicalRecipeJson(command)),
    startedAt: now().toISOString(),
  };
}

export function stickers(input: StickerCommand, requestId: string, session: AuthData): StickerData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new StickerStorageError();
  try {
    const assertLive = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    assertLive();
    const command = stickerCommandSchema.parse(input);
    const properties = PropertiesService.getScriptProperties();
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(properties.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const driveFolderId = properties.getProperty('DRIVE_FOLDER_ID') ?? '';
    if (
      !runtimeEnvironment(properties.getProperty('APP_ENV')) ||
      !spreadsheetId ||
      !driveFolderId ||
      !config.success
    )
      throw new StickerStorageError('STICKER_NOT_READY');
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const directory = () => readWorkspaceDirectory(spreadsheet);
    const actor = resolveWorkspaceAccess(directory(), session.user.id, config.data.workspaceId);
    const store = createRecipeStore(spreadsheet);
    if (
      !planRecipeSchema(store, {
        ...journalMigrationOptions(driveFolderId),
        beforeWrite: assertLive,
      }).alreadyApplied
    )
      throw new StickerStorageError('STICKER_NOT_READY');
    const now = () => new Date();
    const recipeModel = () => ({
      session,
      workspaceId: actor.workspaceId,
      readDirectory: directory,
      store,
      now,
      sha256,
      reader: createRecipeReader(store, sha256),
    });
    const readableRecipe = (recipeId: string, action: 'read' | 'update') => {
      const aggregate = readRecipeAggregate(recipeModel(), recipeId);
      if (!canAccessRecipe(actor, aggregate.recipe, action)) throw new AuthError('ACCESS_DENIED');
      return aggregate;
    };
    if (command.action === 'stickers.packs.list') {
      const { packs, stickers: items } = allPacks(store);
      const query = normalizeStickerName(command.payload.query);
      return {
        kind: 'stickerPacks',
        packs: packs
          .filter((pack) => canReadPack(actor, pack))
          .filter((pack) => command.payload.includeArchived || pack.status === 'active')
          .map((pack) => packView(actor, pack, items))
          .filter(
            (view) =>
              !query ||
              normalizeStickerName(`${view.pack.name} ${view.pack.emoji}`).includes(query) ||
              view.stickers.some((item) => `${item.normalizedName} ${item.emoji}`.includes(query)),
          )
          .sort(
            (a, b) =>
              a.pack.position - b.pack.position || a.pack.name.localeCompare(b.pack.name, 'ru'),
          ),
      };
    }
    if (command.action === 'recipes.stickers.list') {
      readableRecipe(command.payload.recipeId, 'read');
      const { placements } = customPacks(store);
      return {
        kind: 'recipeStickers',
        recipeId: command.payload.recipeId,
        stickers: placements
          .filter((item) => item.recipeId === command.payload.recipeId && item.status === 'active')
          .sort((a, b) => a.page - b.page || a.zIndex - b.zIndex),
      };
    }
    if (command.action === 'stickers.assets.read') {
      const all = allPacks(store);
      let item: StickerItem | undefined;
      const payload = command.payload;
      if ('stickerId' in payload) {
        item = all.stickers.find((candidate) => candidate.id === payload.stickerId);
        if (!item) throw new AuthError('ACCESS_DENIED');
        const pack = requirePack(actor, all.packs, item.packId);
        if (pack.status !== 'active' && !canManagePack(actor, pack))
          throw new AuthError('ACCESS_DENIED');
      } else {
        readableRecipe(payload.recipeId, 'read');
        const placement = all.placements.find(
          (candidate) =>
            candidate.id === payload.instanceId &&
            candidate.recipeId === payload.recipeId &&
            candidate.status === 'active',
        );
        if (!placement) throw new AuthError('ACCESS_DENIED');
        item = all.stickers.find((candidate) => candidate.id === placement.stickerId);
      }
      if (!item || item.assetKey) throw new StickerStorageError('STICKER_INVALID');
      return {
        kind: 'stickerAsset',
        mimeType: item.mimeType,
        base64: readStickerAsset(driveFolderId, item, sha256),
        digest: item.digest,
      };
    }
    if (actor.role === 'viewer') throw new AuthError('ACCESS_DENIED');
    const before = allPacks(store);
    if (command.action === 'stickers.packs.create') {
      if (
        before.packs.filter((pack) => pack.kind === 'custom' && pack.ownerUserId === actor.userId)
          .length >= STICKER_LIMITS.packsPerUser
      )
        throw new StickerStorageError('STICKER_LIMIT');
      const timestamp = now().toISOString();
      const pack = stickerPackSchema.parse({
        id: requestId,
        workspaceId: actor.workspaceId,
        ownerUserId: actor.userId,
        kind: 'custom',
        ...command.payload,
        status: 'active',
        position: before.packs.filter((item) => item.kind === 'custom').length,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const outcome = publishStickerMutation(
        store,
        operation(command, requestId, pack.id, actor, now),
        [{ table: 'StickerPacks', value: pack }],
        now,
      );
      return { kind: 'stickerPack', ...packView(actor, pack, []), outcome };
    }
    if (
      command.action.startsWith('stickers.packs.') ||
      command.action.startsWith('stickers.items.')
    ) {
      const packCommand = command as Extract<
        StickerCommand,
        {
          action:
            | 'stickers.packs.update'
            | 'stickers.packs.archive'
            | 'stickers.packs.restore'
            | 'stickers.items.add'
            | 'stickers.items.reorder'
            | 'stickers.items.archive';
        }
      >;
      const pack = requirePack(actor, before.packs, packCommand.payload.packId, true);
      if (pack.revision !== packCommand.payload.expectedRevision)
        throw new StickerStorageError('STICKER_CONFLICT');
      const timestamp = now().toISOString();
      let nextPack: StickerPack = { ...pack, revision: pack.revision + 1, updatedAt: timestamp };
      const writes: Parameters<typeof publishStickerMutation>[2] = [];
      if (packCommand.action === 'stickers.packs.update')
        nextPack = stickerPackSchema.parse({
          ...nextPack,
          name: packCommand.payload.name,
          emoji: packCommand.payload.emoji,
          visibility: packCommand.payload.visibility,
        });
      else if (packCommand.action === 'stickers.packs.archive')
        nextPack = { ...nextPack, status: 'archived' };
      else if (packCommand.action === 'stickers.packs.restore')
        nextPack = { ...nextPack, status: 'active' };
      else if (packCommand.action === 'stickers.items.add') {
        const active = before.stickers.filter(
          (item) => item.packId === pack.id && item.status === 'active',
        );
        if (
          pack.status !== 'active' ||
          active.length >= STICKER_LIMITS.stickersPerPack ||
          packCommand.payload.position !== active.length ||
          packCommand.payload.upload.uploadId !== requestId
        )
          throw new StickerStorageError('STICKER_CONFLICT');
        const sticker = stickerItemSchema.parse({
          id: requestId,
          packId: pack.id,
          name: packCommand.payload.name,
          normalizedName: normalizeStickerName(packCommand.payload.name),
          emoji: packCommand.payload.emoji,
          position: packCommand.payload.position,
          mimeType: packCommand.payload.upload.mimeType,
          width: packCommand.payload.upload.width,
          height: packCommand.payload.upload.height,
          bytes: packCommand.payload.upload.bytes,
          digest: sha256(packCommand.payload.upload.base64),
          assetKey: null,
          status: 'active',
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        ensureStickerAsset(driveFolderId, sticker, packCommand.payload.upload, sha256);
        writes.push({ table: 'Stickers', value: sticker });
      } else if (packCommand.action === 'stickers.items.reorder') {
        const active = before.stickers.filter(
          (item) => item.packId === pack.id && item.status === 'active',
        );
        if (
          new Set(packCommand.payload.stickerIds).size !== active.length ||
          active.some((item) => !packCommand.payload.stickerIds.includes(item.id))
        )
          throw new StickerStorageError('STICKER_CONFLICT');
        for (const [position, id] of packCommand.payload.stickerIds.entries()) {
          const item = active.find((candidate) => candidate.id === id) as StickerItem;
          writes.push({
            table: 'Stickers',
            value: { ...item, position, revision: item.revision + 1, updatedAt: timestamp },
          });
        }
      } else if (packCommand.action === 'stickers.items.archive') {
        const item = before.stickers.find(
          (candidate) =>
            candidate.id === packCommand.payload.stickerId &&
            candidate.packId === pack.id &&
            candidate.status === 'active',
        );
        if (!item) throw new StickerStorageError('STICKER_CONFLICT');
        writes.push({
          table: 'Stickers',
          value: { ...item, status: 'archived', revision: item.revision + 1, updatedAt: timestamp },
        });
      }
      writes.push({ table: 'StickerPacks', value: nextPack });
      const outcome = publishStickerMutation(
        store,
        operation(packCommand, requestId, pack.id, actor, now),
        writes,
        now,
      );
      const after = allPacks(store);
      return {
        kind: 'stickerPack',
        ...packView(actor, requirePack(actor, after.packs, pack.id, true), after.stickers),
        outcome,
      };
    }
    const recipeCommand = command as Extract<
      StickerCommand,
      { action: 'recipes.stickers.add' | 'recipes.stickers.update' | 'recipes.stickers.delete' }
    >;
    const recipeId = recipeCommand.payload.recipeId;
    const aggregate = readableRecipe(recipeId, 'update');
    const current = before.placements.filter(
      (item) => item.recipeId === recipeId && item.status === 'active',
    );
    const timestamp = now().toISOString();
    let placement: RecipeSticker;
    if (recipeCommand.action === 'recipes.stickers.add') {
      if (
        aggregate.recipe.revision !== recipeCommand.payload.expectedRecipeRevision ||
        current.length >= STICKER_LIMITS.placementsPerRecipe
      )
        throw new StickerStorageError('STICKER_CONFLICT');
      const item = before.stickers.find(
        (candidate) =>
          candidate.id === recipeCommand.payload.stickerId && candidate.status === 'active',
      );
      if (!item) throw new AuthError('ACCESS_DENIED');
      const pack = requirePack(actor, before.packs, item.packId);
      if (pack.status !== 'active') throw new AuthError('ACCESS_DENIED');
      placement = recipeStickerSchema.parse({
        id: requestId,
        recipeId,
        stickerId: item.id,
        packId: item.packId,
        name: item.name,
        emoji: item.emoji,
        mimeType: item.mimeType,
        assetWidth: item.width,
        assetHeight: item.height,
        assetBytes: item.bytes,
        assetDigest: item.digest,
        assetKey: item.assetKey,
        page: recipeCommand.payload.page,
        pageId: `page-${recipeCommand.payload.page}`,
        x: recipeCommand.payload.x,
        y: recipeCommand.payload.y,
        width: recipeCommand.payload.width,
        height: recipeCommand.payload.height,
        rotation: recipeCommand.payload.rotation,
        zIndex: recipeCommand.payload.zIndex,
        status: 'active',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else {
      const previous = current.find((item) => item.id === recipeCommand.payload.instanceId);
      if (!previous || previous.revision !== recipeCommand.payload.expectedRevision)
        throw new StickerStorageError('STICKER_CONFLICT');
      placement =
        recipeCommand.action === 'recipes.stickers.delete'
          ? {
              ...previous,
              status: 'deleted',
              revision: previous.revision + 1,
              updatedAt: timestamp,
            }
          : recipeStickerSchema.parse({
              ...previous,
              page: recipeCommand.payload.page,
              pageId: `page-${recipeCommand.payload.page}`,
              x: recipeCommand.payload.x,
              y: recipeCommand.payload.y,
              width: recipeCommand.payload.width,
              height: recipeCommand.payload.height,
              rotation: recipeCommand.payload.rotation,
              zIndex: recipeCommand.payload.zIndex,
              revision: previous.revision + 1,
              updatedAt: timestamp,
            });
    }
    const outcome = publishStickerMutation(
      store,
      operation(recipeCommand, requestId, placement.id, actor, now),
      [{ table: 'RecipeStickers', value: placement }],
      now,
    );
    assertLive();
    return { kind: 'recipeSticker', recipeId, sticker: placement, outcome };
  } catch (error) {
    if (error instanceof AuthError || error instanceof StickerStorageError) throw error;
    throw new StickerStorageError();
  } finally {
    lock.releaseLock();
  }
}
