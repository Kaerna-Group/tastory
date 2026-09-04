import {
  RECIPE_LIMITS,
  recipeCommandSchema,
  recipePhotoSchema,
  recipeSchema,
} from '@tastory/contracts';
import type { AuthData, RecipeCommand, RecipeData } from '@tastory/contracts';
import { canAccessRecipe } from '@tastory/domain';
import { AuthError } from '../auth/google-token';
import { resolveWorkspaceAccess, sheetsAuthConfigSchema } from '../auth/workspace-access';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { createRecipeStore } from './recipe-store';
import { createRecipeArchive } from './recipe-archive';
import {
  archiveRecipeHistory,
  historicalSnapshot,
  recipeHistory,
  readRecipeVersion,
} from '../services/recipe-history';
import { recipeRows, readRecipeOperations, dataTables } from '../services/recipe-storage';
import { journalMigrationOptions, sha256 } from './current-schema';
import { planRecipeSchema, applyRecipeSchema } from '../services/recipe-migration';
import { RecipeStorageError } from '../services/recipe-storage';
import {
  RecipeModelError,
  readRecipeAggregate,
  listRecipeSummaries,
  listRecipeTags,
  authorizeRecipeObject,
} from '../services/recipe-model';
import { createRecipeReader } from '../services/recipe-reader';
import {
  mutateRecipe,
  resumeRecipeOperation,
  cancelRecipeOperation,
  listRecipeOperations,
} from '../services/recipe-mutations';
import { runtimeEnvironment } from './runtime-environment';
import { ensureRecipePhoto, readRecipePhoto } from './recipe-photos';
import { PhotoError } from '../services/photo-error';
import { setRecipeFavorite } from '../services/recipe-favorites';
import { manageFiles } from '../services/file-lifecycle';

export function recipes(input: RecipeCommand, requestId: string, session: AuthData): RecipeData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new RecipeStorageError();
  try {
    const assertLive = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    assertLive();
    const command = recipeCommandSchema.parse(input);
    const properties = PropertiesService.getScriptProperties();
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(properties.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!runtimeEnvironment(properties.getProperty('APP_ENV')) || !spreadsheetId || !config.success)
      throw new RecipeStorageError('RECIPE_NOT_READY');
    const driveFolderId = properties.getProperty('DRIVE_FOLDER_ID') ?? '';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const readDirectory = () => readWorkspaceDirectory(spreadsheet);
    const actor = resolveWorkspaceAccess(readDirectory(), session.user.id, config.data.workspaceId);
    const store = createRecipeStore(spreadsheet);
    store.archive = createRecipeArchive(store, driveFolderId, sha256);
    const options = {
      ...journalMigrationOptions(driveFolderId),
      beforeWrite: assertLive,
    };
    if (command.action === 'admin.recipes.initialize') {
      if (actor.role !== 'owner') throw new AuthError('ACCESS_DENIED');
      const plan = planRecipeSchema(store, options);
      applyRecipeSchema(store, options);
      assertLive();
      return { kind: 'initialized', schemaVersion: 6, alreadyApplied: plan.alreadyApplied };
    }
    if (!planRecipeSchema(store, options).alreadyApplied)
      throw new RecipeStorageError('RECIPE_NOT_READY');
    const context = {
      session,
      workspaceId: actor.workspaceId,
      readDirectory,
      store,
      now: () => new Date(),
      sha256,
    };
    const model = () => ({ ...context, reader: createRecipeReader(store, sha256) });
    let result: RecipeData;
    switch (command.action) {
      case 'admin.files.audit':
      case 'admin.files.trash':
      case 'admin.files.trashUnused':
      case 'admin.files.restore':
      case 'admin.files.cleanup':
        if (actor.role !== 'owner') throw new AuthError('ACCESS_DENIED');
        if (!driveFolderId) throw new RecipeStorageError('RECIPE_NOT_READY');
        result = manageFiles(
          {
            folderId: driveFolderId,
            store,
            properties,
            sha256,
            now: () => new Date(),
            assertAuthorized: assertLive,
          },
          command,
        );
        break;
      case 'recipes.history':
        result = recipeHistory(context, command.payload.recipeId, command.payload.beforeRevision);
        break;
      case 'recipes.version':
        result = {
          kind: 'recipe',
          aggregate: readRecipeVersion(context, command.payload.recipeId, command.payload.revision),
          permissions: { edit: false, archive: false, restore: false },
        };
        break;
      case 'admin.recipes.archiveHistory':
        if (actor.role !== 'owner') throw new AuthError('ACCESS_DENIED');
        result = { kind: 'archivedHistory', ...archiveRecipeHistory(store, sha256, assertLive) };
        break;
      case 'recipes.list':
        result = { kind: 'recipes', recipes: listRecipeSummaries(model()) };
        break;
      case 'recipes.favorite.set':
        result = {
          kind: 'favorite',
          ...setRecipeFavorite(
            { ...context, reader: createRecipeReader(store, sha256) },
            command.payload,
            requestId,
          ),
        };
        break;
      case 'recipes.get': {
        const aggregate = readRecipeAggregate(model(), command.payload.recipeId);
        result = {
          kind: 'recipe',
          aggregate,
          permissions: {
            edit: canAccessRecipe(actor, aggregate.recipe, 'update'),
            archive: canAccessRecipe(actor, aggregate.recipe, 'archive'),
            restore: canAccessRecipe(actor, aggregate.recipe, 'restore'),
          },
        };
        break;
      }
      case 'recipes.photos.read': {
        const aggregate = readRecipeAggregate(model(), command.payload.recipeId);
        let photo = aggregate.photos.find((item) => item.id === command.payload.photoId);
        if (!photo) {
          for (const operation of readRecipeOperations(store).reverse()) {
            if (
              operation.entityType !== 'recipe' ||
              operation.entityId !== aggregate.recipe.id ||
              !operation.state.startsWith('committed@')
            )
              continue;
            const row = historicalSnapshot(store, operation, sha256).RecipePhotos.find(
              (item) => item.id === command.payload.photoId,
            );
            if (row) {
              photo = recipePhotoSchema.parse(row);
              break;
            }
          }
        }
        if (!photo) throw new AuthError('ACCESS_DENIED');
        result = {
          kind: 'photo',
          photo,
          variant: command.payload.variant,
          base64: readRecipePhoto(driveFolderId, photo, command.payload.variant, sha256),
        };
        break;
      }
      case 'tags.list':
        result = { kind: 'tags', tags: listRecipeTags(model()) };
        break;
      case 'recipes.operations.list':
        result = listRecipeOperations(context);
        break;
      case 'recipes.operations.resume':
        result = { kind: 'saved', ...resumeRecipeOperation(context, command.payload.operationId) };
        break;
      case 'recipes.operations.cancel':
        result = { kind: 'saved', ...cancelRecipeOperation(context, command.payload.operationId) };
        break;
      default:
        if (command.action === 'recipes.photos.add') {
          const recipe = recipeSchema.parse(
            authorizeRecipeObject(model(), {
              kind: 'recipe',
              id: command.payload.recipeId,
              action: 'update',
            }),
          );
          if (
            command.payload.photo.uploadId !== requestId ||
            recipe.revision !== command.payload.expectedRevision
          )
            throw new RecipeStorageError('RECIPE_CONFLICT');
          const current = readRecipeAggregate(model(), recipe.id);
          const target = command.payload.target;
          const sameGroup = current.photos.filter(
            (item) =>
              item.kind === target.kind &&
              item.stepId === (target.kind === 'step' ? target.stepId : null),
          );
          if (
            current.photos.some((item) => item.id === requestId) ||
            (target.kind === 'step' && !current.steps.some((step) => step.id === target.stepId)) ||
            (target.kind !== 'cover' && target.position !== sameGroup.length) ||
            (target.kind === 'gallery' && sameGroup.length >= RECIPE_LIMITS.galleryPhotos) ||
            (target.kind === 'step' && sameGroup.length >= RECIPE_LIMITS.stepPhotos) ||
            (target.kind === 'cover' &&
              current.photos.some((item) => item.kind === 'cover') &&
              current.photos.filter((item) => item.kind === 'gallery').length >=
                RECIPE_LIMITS.galleryPhotos)
          )
            throw new RecipeStorageError('RECIPE_CONFLICT');
          const timestamp = new Date().toISOString();
          const photo = recipePhotoSchema.parse({
            id: requestId,
            recipeId: recipe.id,
            kind: command.payload.target.kind,
            stepId: command.payload.target.kind === 'step' ? command.payload.target.stepId : null,
            position: command.payload.target.position,
            width: command.payload.photo.width,
            height: command.payload.photo.height,
            bytes: command.payload.photo.imageBytes,
            thumbnailBytes: command.payload.photo.thumbnailBytes,
            imageDigest: sha256(command.payload.photo.imageBase64),
            thumbnailDigest: sha256(command.payload.photo.thumbnailBase64),
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: 1,
          });
          ensureRecipePhoto(driveFolderId, photo, command.payload.photo, sha256);
        }
        if (
          actor.role !== 'viewer' &&
          !readRecipeOperations(store).some((op) => op.requestId === requestId) &&
          (recipeRows(store, 'RecipeOperations').length >= 500 ||
            dataTables.some((table) => recipeRows(store, table).length >= 5000))
        )
          archiveRecipeHistory(store, sha256, assertLive);
        result = { kind: 'saved', ...mutateRecipe(context, command, requestId) };
    }
    assertLive();
    return result;
  } catch (error) {
    if (
      error instanceof AuthError ||
      error instanceof RecipeStorageError ||
      error instanceof RecipeModelError ||
      error instanceof PhotoError
    )
      throw error;
    throw new RecipeStorageError();
  } finally {
    lock.releaseLock();
  }
}
