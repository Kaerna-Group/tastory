import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  BUILTIN_RECIPE_TEMPLATES,
  BUILTIN_STICKER_PACKS,
  TEMPLATE_API_CAPABILITIES,
  DEFAULT_RECIPE_THEME,
  recipeCommandSchema,
  recipeSummarySchema,
  stickerCommandSchema,
  templateCommandSchema,
  templateMutationActions,
} from '@tastory/contracts';
import type {
  RecipeAggregate,
  RecipeData,
  RecipeDesign,
  RecipeSticker,
  RecipeTemplate,
  RecipeTemplateRecord,
  TemplateData,
} from '@tastory/contracts';

const provider = `window.google = { accounts: { id: {
  initialize(options) { this.callback = options.callback; },
  renderButton(element) { const button = document.createElement('button'); button.textContent = 'Google (тест)'; button.onclick = () => this.callback({ credential: 'private-recipe-test-token' }); element.append(button); },
  disableAutoSelect() {}
} } };`;
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const state = await page.evaluate(() => {
    const fonts: string[][] = [];
    document.fonts.forEach((font) => fonts.push([font.family, font.status]));
    return {
      text: document.querySelector('.recipe-book-view')?.textContent,
      layout: (document.querySelector('.recipe-page-spread') as HTMLElement | null)?.dataset,
      assets: (document.querySelector('.recipe-page-preview') as HTMLElement | null)?.dataset,
      fonts,
      images: Array.from(document.querySelectorAll<HTMLImageElement>('.recipe-book-view img')).map(
        (image) => [image.complete, image.naturalWidth],
      ),
    };
  });
  await testInfo.attach('print-state', {
    body: JSON.stringify(state, null, 2),
    contentType: 'application/json',
  });
});
async function fixture(page: Page) {
  // The photo API returns JPEG. A PNG disguised as JPEG is rejected by WebKit's decoder.
  const photoImageBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Fixture image canvas unavailable.');
    context.fillStyle = '#d8e9e5';
    context.fillRect(0, 0, 480, 320);
    context.fillStyle = '#527b70';
    context.fillRect(24, 24, 432, 16);
    context.fillRect(24, 280, 432, 16);
    context.font = '32px sans-serif';
    context.fillText('TEST PHOTO', 128, 172);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  });
  let remote: RecipeAggregate | null = null;
  let blocked = false;
  let readonly = false;
  let recipeReady = true;
  let photoDelay = 0;
  let photosUnavailable = false;
  let designUnavailable = false;
  let photoGate: { started: () => void; response: Promise<void> } | null = null;
  let templateDelay = 0;
  let loseNextTemplateMutationResponse = false;
  let failNextTemplateRefresh = false;
  let restoreResponseDelay: { started: () => void; response: Promise<void> } | null = null;
  let includeCover = false;
  let subject = 'chef-sub';
  const photoReads: Array<{ recipeId: string; photoId: string; variant: 'image' | 'thumbnail' }> =
    [];
  const favoriteUsers = new Set<string>();
  const receipts = new Map<string, RecipeData>();
  const versions = new Map<number, RecipeAggregate>();
  const templateReceipts = new Map<string, { command: string; data: TemplateData }>();
  let stickerPlacements: RecipeSticker[] = [];
  let appliedTemplate: RecipeTemplate | null = null;
  let appliedDesign: RecipeDesign | null = null;
  const commands: { action: string; requestId: string }[] = [];
  let settings = {
    displayName: 'Повар',
    unitSystem: 'metric',
    temperatureUnit: 'celsius',
    defaultVisibility: 'private',
    editorDensity: 'comfortable',
    autosaveDelay: 900,
    keyboardShortcuts: true,
    confirmDestructiveActions: true,
    revision: 0,
    updatedAt: null as string | null,
  };
  const recipeId = randomUUID(),
    workspaceId = randomUUID(),
    ownerUserId = randomUUID();
  const tagTimestamp = new Date().toISOString();
  const availableTag = {
    id: randomUUID(),
    workspaceId,
    normalizedName: 'выпечка',
    createdBy: ownerUserId,
    status: 'active' as const,
    name: 'Выпечка',
    colorToken: 'accent' as const,
    revision: 1,
    createdAt: tagTimestamp,
    updatedAt: tagTimestamp,
  };
  const coverPhoto = {
    id: randomUUID(),
    recipeId,
    kind: 'cover' as const,
    stepId: null,
    position: 0,
    width: 480,
    height: 320,
    bytes: Math.floor(photoImageBase64.length * 0.75),
    thumbnailBytes: Math.floor(photoImageBase64.length * 0.75),
    imageDigest: 'a'.repeat(64),
    thumbnailDigest: 'b'.repeat(64),
    revision: 1,
    createdAt: tagTimestamp,
    updatedAt: tagTimestamp,
  };
  const communitySource = BUILTIN_RECIPE_TEMPLATES.find(
    (template) => template.layout === 'fresh-bar',
  );
  if (!communitySource) throw new Error('Missing builtin template fixture.');
  const communityTemplate: RecipeTemplateRecord = {
    id: randomUUID(),
    workspaceId,
    ownerUserId: randomUUID(),
    kind: 'custom',
    name: 'Летний аперитив',
    description: 'Свежая страница от участника тетради',
    category: 'drink',
    layout: 'fresh-bar',
    visibility: 'workspace',
    status: 'active',
    sourceTemplateId: communitySource.id,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let customTemplates: RecipeTemplateRecord[] = [communityTemplate];
  await page
    .context()
    .route('https://accounts.google.com/gsi/client', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: provider }),
    );
  await page
    .context()
    .route('https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec', async (route) => {
      const request = route.request().postDataJSON() as {
        action: string;
        requestId: string;
        payload?: Record<string, unknown>;
      };
      let data: unknown;
      if (request.action.startsWith('auth.'))
        data = {
          user: {
            id: subject,
            email: `${subject}@example.test`,
            name: 'Повар',
            role: readonly ? 'viewer' : 'owner',
          },
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
      else if (request.action === 'health')
        data = {
          status: 'ok',
          service: 'tastory-api',
          deploymentVersion: 'fixture',
          timestamp: new Date().toISOString(),
          storage: 'not-configured',
          auth: 'production',
        };
      else if (request.action === 'user.settings.get')
        data = { kind: 'userSettings', settings, outcome: 'read' };
      else if (request.action === 'user.settings.update') {
        const payload = request.payload as { expectedRevision: number; value: typeof settings };
        settings = {
          ...payload.value,
          revision: payload.expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        };
        data = { kind: 'userSettings', settings, outcome: 'committed' };
      } else if (
        request.action.startsWith('stickers.') ||
        request.action.startsWith('recipes.stickers.')
      ) {
        const command = stickerCommandSchema.parse({
          action: request.action,
          payload: request.payload,
        });
        commands.push({ action: command.action, requestId: request.requestId });
        if (command.action === 'stickers.packs.list')
          data = {
            kind: 'stickerPacks',
            packs: BUILTIN_STICKER_PACKS.map((pack) => ({ ...pack, canManage: false })),
          };
        else if (command.action === 'recipes.stickers.list')
          data = {
            kind: 'recipeStickers',
            recipeId: command.payload.recipeId,
            stickers: stickerPlacements,
          };
        else if (command.action === 'recipes.stickers.add') {
          const source = BUILTIN_STICKER_PACKS.flatMap((pack) => pack.stickers).find(
            (item) => item.id === command.payload.stickerId,
          );
          if (!source) throw new Error('Unknown builtin sticker in fixture.');
          const now = new Date().toISOString();
          const placement: RecipeSticker = {
            id: randomUUID(),
            recipeId: command.payload.recipeId,
            stickerId: source.id,
            packId: source.packId,
            name: source.name,
            emoji: source.emoji,
            mimeType: source.mimeType,
            assetWidth: source.width,
            assetHeight: source.height,
            assetBytes: source.bytes,
            assetDigest: source.digest,
            assetKey: source.assetKey,
            page: command.payload.page,
            x: command.payload.x,
            y: command.payload.y,
            width: command.payload.width,
            height: command.payload.height,
            rotation: command.payload.rotation,
            zIndex: command.payload.zIndex,
            status: 'active',
            revision: 1,
            createdAt: now,
            updatedAt: now,
          };
          stickerPlacements = [...stickerPlacements, placement];
          data = {
            kind: 'recipeSticker',
            recipeId: command.payload.recipeId,
            sticker: placement,
            outcome: 'committed',
          };
        } else if (command.action === 'recipes.stickers.update') {
          const previous = stickerPlacements.find((item) => item.id === command.payload.instanceId);
          if (!previous || previous.revision !== command.payload.expectedRevision)
            throw new Error('Stale sticker update.');
          const {
            recipeId: targetRecipeId,
            instanceId,
            expectedRevision,
            ...geometry
          } = command.payload;
          const sticker = { ...previous, ...geometry, revision: expectedRevision + 1 };
          stickerPlacements = stickerPlacements.map((item) =>
            item.id === instanceId ? sticker : item,
          );
          data = { kind: 'recipeSticker', recipeId: targetRecipeId, sticker, outcome: 'committed' };
        } else throw new Error(`Unexpected sticker fixture action: ${command.action}`);
      } else if (
        request.action.startsWith('templates.') ||
        request.action.startsWith('recipes.template.') ||
        request.action.startsWith('recipes.design.')
      ) {
        const command = templateCommandSchema.parse({
          action: request.action,
          payload: request.payload,
        });
        const mutation = new Set<string>(templateMutationActions).has(command.action);
        const fingerprint = JSON.stringify(command);
        const receipt = templateReceipts.get(request.requestId);
        if (receipt && receipt.command !== fingerprint) {
          await route.fulfill({
            json: {
              ok: false,
              requestId: request.requestId,
              error: { code: 'TEMPLATE_CONFLICT', message: 'Команда повтора изменилась.' },
            },
          });
          return;
        }
        if (
          designUnavailable &&
          ['recipes.template.get', 'recipes.design.get'].includes(command.action)
        ) {
          await route.abort();
          return;
        }
        if (
          failNextTemplateRefresh &&
          !mutation &&
          [
            'templates.capabilities',
            'templates.list',
            'recipes.template.get',
            'recipes.design.get',
          ].includes(command.action)
        ) {
          failNextTemplateRefresh = false;
          await route.abort();
          return;
        }
        if (
          (command.action === 'recipes.template.get' || command.action === 'recipes.design.get') &&
          templateDelay > 0
        )
          await new Promise((resolve) => setTimeout(resolve, templateDelay));
        commands.push({ action: command.action, requestId: request.requestId });
        const allTemplates = [...BUILTIN_RECIPE_TEMPLATES, ...customTemplates];
        if (receipt) {
          data =
            receipt.data.kind === 'template' ||
            receipt.data.kind === 'recipeTemplate' ||
            receipt.data.kind === 'recipeDesign'
              ? { ...receipt.data, outcome: 'replayed' }
              : receipt.data;
        } else if (command.action === 'templates.capabilities') {
          data = TEMPLATE_API_CAPABILITIES;
        } else if (command.action === 'templates.list') {
          const needle = command.payload.query.trim().toLocaleLowerCase('ru');
          const filtered = allTemplates
            .filter((template) => command.payload.includeArchived || template.status === 'active')
            .filter(
              (template) =>
                command.payload.category === 'all' ||
                template.category === command.payload.category,
            )
            .filter((template) => {
              if (command.payload.scope === 'mine') return template.ownerUserId === ownerUserId;
              if (command.payload.scope === 'community')
                return template.kind === 'custom' && template.ownerUserId !== ownerUserId;
              return true;
            })
            .filter(
              (template) =>
                !needle ||
                `${template.name} ${template.description}`.toLocaleLowerCase('ru').includes(needle),
            )
            .map((template) => ({
              template,
              authorName: template.kind === 'builtin' ? 'Tastory' : 'Повар Анна',
              canManage:
                !readonly && template.kind === 'custom' && template.ownerUserId === ownerUserId,
              canCopy:
                !readonly && (template.kind === 'builtin' || template.ownerUserId !== ownerUserId),
            }));
          const offset = command.payload.offset ?? 0;
          const limit = command.payload.limit ?? 100;
          const end = Math.min(offset + limit, filtered.length);
          data = {
            kind: 'templateLibrary',
            templates: filtered.slice(offset, end),
            ...(command.payload.offset === undefined
              ? {}
              : { nextOffset: end < filtered.length ? end : null }),
          };
        } else if (command.action === 'recipes.template.get') {
          data = {
            kind: 'recipeTemplate',
            recipeId: command.payload.recipeId,
            template: appliedTemplate,
            outcome: 'read',
          };
        } else if (command.action === 'recipes.design.get') {
          data = {
            kind: 'recipeDesign',
            recipeId: command.payload.recipeId,
            design: appliedDesign,
            outcome: 'read',
          };
        } else if (command.action === 'recipes.template.apply') {
          if (
            remote?.recipe.revision !== command.payload.expectedRecipeRevision ||
            (appliedTemplate?.revision ?? null) !==
              command.payload.expectedRecipeTemplateRevision ||
            (command.payload.design &&
              (appliedDesign?.revision ?? null) !== command.payload.expectedRecipeDesignRevision)
          ) {
            await route.fulfill({
              json: {
                ok: false,
                requestId: request.requestId,
                error: { code: 'TEMPLATE_CONFLICT', message: 'Оформление изменено.' },
              },
            });
            return;
          }
          const source = allTemplates.find(
            (template) => template.id === command.payload.templateId,
          );
          if (!source) throw new Error('Unknown template in fixture.');
          const now = new Date().toISOString();
          appliedTemplate = {
            id: command.payload.recipeId,
            recipeId: command.payload.recipeId,
            templateId: source.id,
            templateName: source.name,
            category: source.category,
            layout: source.layout,
            theme: command.payload.theme,
            sourceOwnerUserId: source.ownerUserId,
            revision: (appliedTemplate?.revision ?? 0) + 1,
            createdAt: appliedTemplate?.createdAt ?? now,
            updatedAt: now,
          };
          if (command.payload.design)
            appliedDesign = {
              id: command.payload.recipeId,
              recipeId: command.payload.recipeId,
              revision: (appliedDesign?.revision ?? 0) + 1,
              recipeTemplateRevision: appliedTemplate.revision,
              sourceTemplateId: source.id,
              sourceTemplateRevision: source.revision,
              value: command.payload.design,
              createdAt: appliedDesign?.createdAt ?? now,
              updatedAt: now,
            };
          data = {
            kind: 'recipeTemplate',
            recipeId: command.payload.recipeId,
            template: appliedTemplate,
            outcome: 'committed',
          };
        } else if (command.action === 'recipes.design.save') {
          if ((appliedDesign?.revision ?? null) !== command.payload.expectedRevision) {
            await route.fulfill({
              json: {
                ok: false,
                requestId: request.requestId,
                error: { code: 'TEMPLATE_CONFLICT', message: 'Оформление изменено.' },
              },
            });
            return;
          }
          const now = new Date().toISOString();
          appliedDesign = {
            id: command.payload.recipeId,
            recipeId: command.payload.recipeId,
            revision: (appliedDesign?.revision ?? 0) + 1,
            recipeTemplateRevision: appliedTemplate?.revision ?? null,
            sourceTemplateId: appliedTemplate?.templateId ?? null,
            sourceTemplateRevision: null,
            value: command.payload.value,
            createdAt: appliedDesign?.createdAt ?? now,
            updatedAt: now,
          };
          data = {
            kind: 'recipeDesign',
            recipeId: command.payload.recipeId,
            design: appliedDesign,
            outcome: 'committed',
          };
        } else if (command.action === 'templates.create' || command.action === 'templates.clone') {
          const source =
            command.action === 'templates.clone'
              ? allTemplates.find((template) => template.id === command.payload.templateId)
              : null;
          const now = new Date().toISOString();
          const layout =
            source?.layout ??
            (command.action === 'templates.create' ? command.payload.layout : 'hearth');
          const created: RecipeTemplateRecord = {
            id: request.requestId,
            workspaceId,
            ownerUserId,
            kind: 'custom',
            name:
              command.action === 'templates.clone'
                ? (command.payload.name ?? `${source?.name ?? 'Шаблон'} — моя`)
                : command.payload.name,
            description:
              command.action === 'templates.clone'
                ? (source?.description ?? '')
                : command.payload.description,
            category:
              layout === 'fresh-bar' ||
              layout === 'coffeehouse' ||
              layout === 'tea-ceremony' ||
              layout === 'cocktail-night' ||
              layout === 'wine-cellar'
                ? 'drink'
                : 'dish',
            layout,
            visibility: command.payload.visibility,
            status: 'active',
            sourceTemplateId: source?.id ?? null,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          };
          customTemplates = [...customTemplates, created];
          data = {
            kind: 'template',
            template: created,
            authorName: 'Повар',
            canManage: true,
            canCopy: false,
            outcome: 'committed',
          };
        } else if (
          command.action === 'templates.archive' ||
          command.action === 'templates.restore' ||
          command.action === 'templates.update'
        ) {
          const current = customTemplates.find(
            (template) => template.id === command.payload.templateId,
          );
          if (!current) throw new Error('Unknown custom template in fixture.');
          const next: RecipeTemplateRecord =
            command.action === 'templates.update'
              ? {
                  ...current,
                  name: command.payload.name,
                  description: command.payload.description,
                  layout: command.payload.layout,
                  category: [
                    'coffeehouse',
                    'tea-ceremony',
                    'cocktail-night',
                    'fresh-bar',
                    'wine-cellar',
                  ].includes(command.payload.layout)
                    ? 'drink'
                    : 'dish',
                  visibility: command.payload.visibility,
                  revision: current.revision + 1,
                  updatedAt: new Date().toISOString(),
                }
              : {
                  ...current,
                  status: command.action === 'templates.archive' ? 'archived' : 'active',
                  revision: current.revision + 1,
                  updatedAt: new Date().toISOString(),
                };
          customTemplates = customTemplates.map((template) =>
            template.id === current.id ? next : template,
          );
          data = {
            kind: 'template',
            template: next,
            authorName: 'Повар',
            canManage: true,
            canCopy: false,
            outcome: 'committed',
          };
        } else throw new Error('Unexpected template fixture action.');
        if (mutation && !receipt) {
          templateReceipts.set(request.requestId, {
            command: fingerprint,
            data: data as TemplateData,
          });
          if (loseNextTemplateMutationResponse) {
            loseNextTemplateMutationResponse = false;
            await route.abort();
            return;
          }
        }
      } else if (
        request.action.startsWith('recipes.') ||
        request.action.startsWith('tags.') ||
        request.action.startsWith('admin.recipes.')
      ) {
        const raw = route.request().postDataJSON() as Record<string, unknown>;
        const command = recipeCommandSchema.parse({
          action: raw['action'],
          payload: raw['payload'],
        });
        commands.push({ action: command.action, requestId: request.requestId });
        if (command.action === 'recipes.list' && !recipeReady) {
          await route.fulfill({
            json: {
              ok: false,
              requestId: request.requestId,
              error: { code: 'RECIPE_NOT_READY', message: 'Требуется миграция.' },
            },
          });
          return;
        } else if (command.action === 'admin.recipes.initialize') {
          recipeReady = true;
          data = { kind: 'initialized', schemaVersion: 9, alreadyApplied: false };
        } else if (command.action === 'recipes.list')
          data = {
            kind: 'recipes',
            recipes: remote
              ? [
                  recipeSummarySchema.parse({
                    ...Object.fromEntries(
                      Object.entries(remote.recipe).filter(
                        ([key]) => !['notes', 'sourceUrl', 'deletedAt'].includes(key),
                      ),
                    ),
                    ingredientNames: remote.ingredients.map((ingredient) => ingredient.name),
                    tags: remote.tags.map(({ id, name, colorToken }) => ({ id, name, colorToken })),
                    coverPhotoId: remote.photos.find((photo) => photo.kind === 'cover')?.id ?? null,
                    favorite: favoriteUsers.has(subject),
                  }),
                ]
              : [],
          };
        else if (command.action === 'recipes.favorite.set') {
          if (command.payload.favorite) favoriteUsers.add(subject);
          else favoriteUsers.delete(subject);
          data = {
            kind: 'favorite',
            recipeId: command.payload.recipeId,
            favorite: command.payload.favorite,
            outcome: 'committed',
          };
        } else if (command.action === 'tags.list') data = { kind: 'tags', tags: [availableTag] };
        else if (command.action === 'recipes.get' && remote)
          data = {
            kind: 'recipe',
            aggregate: remote,
            permissions: { edit: !readonly, archive: !readonly, restore: false },
          };
        else if (command.action === 'recipes.operations.list')
          data = { kind: 'operations', operations: [] };
        else if (command.action === 'recipes.history')
          data = {
            kind: 'history',
            recipeId,
            versions: [...versions.values()].reverse().map((aggregate) => ({
              revision: aggregate.recipe.revision,
              action: 'recipes.updateContent',
              completedAt: aggregate.recipe.updatedAt,
            })),
            nextBeforeRevision: null,
          };
        else if (command.action === 'recipes.photos.read') {
          photoReads.push({
            recipeId: command.payload.recipeId,
            photoId: command.payload.photoId,
            variant: command.payload.variant,
          });
          if (photoGate) {
            photoGate.started();
            await photoGate.response;
          }
          if (photosUnavailable) {
            await route.abort('failed');
            return;
          }
          const photo = remote?.photos.find((item) => item.id === command.payload.photoId);
          if (!photo) throw new Error('Unknown photo fixture request.');
          if (photoDelay > 0) await new Promise((resolve) => setTimeout(resolve, photoDelay));
          data = {
            kind: 'photo',
            photo,
            variant: command.payload.variant,
            base64: photoImageBase64,
          };
        } else if (command.action === 'recipes.version')
          data = {
            kind: 'recipe',
            aggregate: versions.get(command.payload.revision),
            permissions: { edit: false, archive: false, restore: false },
          };
        else if (command.action === 'recipes.version.restore') {
          if (readonly) {
            await route.fulfill({
              json: {
                ok: false,
                requestId: request.requestId,
                error: { code: 'ACCESS_DENIED', message: 'Нет права редактирования.' },
              },
            });
            return;
          }
          if (receipts.has(request.requestId)) data = receipts.get(request.requestId);
          else {
            const target = versions.get(command.payload.targetRevision);
            if (
              !remote ||
              !target ||
              command.payload.expectedRevision !== remote.recipe.revision ||
              command.payload.targetRevision >= remote.recipe.revision
            ) {
              await route.fulfill({
                json: {
                  ok: false,
                  requestId: request.requestId,
                  error: { code: 'RECIPE_CONFLICT', message: 'Рецепт изменён в другом месте.' },
                },
              });
              return;
            }
            const current = remote;
            const revision = current.recipe.revision + 1;
            remote = structuredClone({
              ...target,
              recipe: {
                ...target.recipe,
                ownerUserId: current.recipe.ownerUserId,
                status: current.recipe.status,
                createdAt: current.recipe.createdAt,
                updatedAt: new Date().toISOString(),
                revision,
                deletedAt: null,
              },
            });
            data = {
              kind: 'saved',
              operationId: request.requestId,
              entityId: recipeId,
              entityType: 'recipe',
              revision,
              outcome: 'committed',
            };
            receipts.set(request.requestId, data as RecipeData);
            versions.set(revision, structuredClone(remote));
          }
          const delayedResponse = restoreResponseDelay;
          if (delayedResponse) {
            restoreResponseDelay = null;
            delayedResponse.started();
            await delayedResponse.response;
          }
        } else if (
          command.action === 'recipes.create' ||
          command.action === 'recipes.updateContent'
        ) {
          if (readonly) {
            await route.fulfill({
              json: {
                ok: false,
                requestId: request.requestId,
                error: { code: 'ACCESS_DENIED', message: 'Нет права редактирования.' },
              },
            });
            return;
          }
          if (receipts.has(request.requestId)) data = receipts.get(request.requestId);
          else {
            if (
              command.action === 'recipes.updateContent' &&
              command.payload.expectedRevision !== remote?.recipe.revision
            ) {
              await route.fulfill({
                json: {
                  ok: false,
                  requestId: request.requestId,
                  error: { code: 'RECIPE_CONFLICT', message: 'Рецепт изменён в другом месте.' },
                },
              });
              return;
            }
            const audit = {
              createdAt: remote?.recipe.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              revision: (remote?.recipe.revision ?? 0) + 1,
            };
            const selectedTags = command.payload.value.tagIds.includes(availableTag.id)
              ? [availableTag]
              : [];
            remote = {
              recipe: {
                ...command.payload.value.content,
                ...audit,
                id: recipeId,
                workspaceId,
                ownerUserId,
                visibility:
                  command.action === 'recipes.create'
                    ? command.payload.visibility
                    : (remote?.recipe.visibility ?? 'private'),
                status: 'draft',
                deletedAt: null,
              },
              ingredients: command.payload.value.ingredients.map((row) => ({
                ...row,
                ...audit,
                recipeId,
                id: row.id ?? randomUUID(),
              })),
              steps: command.payload.value.steps.map((row) => ({
                ...row,
                ...audit,
                recipeId,
                id: row.id ?? randomUUID(),
              })),
              photos: remote?.photos ?? (includeCover ? [coverPhoto] : []),
              tags: selectedTags,
              recipeTags: selectedTags.map((tag) => ({
                recipeId,
                tagId: tag.id,
                assignedBy: ownerUserId,
                ...audit,
              })),
            };
            data = {
              kind: 'saved',
              operationId: request.requestId,
              entityId: recipeId,
              entityType: 'recipe',
              revision: audit.revision,
              outcome: 'committed',
            };
            receipts.set(request.requestId, data as RecipeData);
            versions.set(remote.recipe.revision, structuredClone(remote));
          }
          // The write succeeds but its response may be lost, just like a network interruption.
          if (blocked) {
            await route.abort();
            return;
          }
        } else throw new Error(`Unexpected recipe fixture action: ${command.action}`);
      } else data = { photo: null, thumbnailBase64: null };
      await route.fulfill({
        json: {
          ok: true,
          requestId: request.requestId,
          data,
          meta: { apiVersion: 1, schemaVersion: 0 },
        },
      });
    });
  return {
    commands,
    photoReads: () => [...photoReads],
    clearPhotoReads: () => photoReads.splice(0),
    receipts,
    recipeId,
    remote: () => remote,
    placements: () => stickerPlacements,
    design: () => appliedDesign,
    advanceDesign: () => {
      if (!appliedDesign) throw new Error('A saved design is required.');
      appliedDesign = {
        ...appliedDesign,
        revision: appliedDesign.revision + 1,
        updatedAt: new Date().toISOString(),
        value: {
          ...appliedDesign.value,
          elements: appliedDesign.value.elements.map((element) =>
            element.binding === 'title' ? { ...element, x: Math.max(0, element.x - 1) } : element,
          ),
        },
      };
      return appliedDesign;
    },
    designUnavailable: (value: boolean) => {
      designUnavailable = value;
    },
    holdPhotos: () => {
      let started: () => void = () => {};
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      photoGate = { started, response };
      return {
        waiting,
        release: () => {
          photoGate = null;
          release();
        },
      };
    },
    preparePrint: () => {
      if (!remote) throw new Error('A saved recipe is required.');
      remote = {
        ...remote,
        recipe: { ...remote.recipe, revision: remote.recipe.revision + 1 },
        steps: remote.steps.map((step) => ({ ...step, durationSeconds: 30 })),
      };
      stickerPlacements = stickerPlacements.map((item) => ({
        ...item,
        x: 72,
        y: 73,
        width: 12,
        height: 12,
      }));
      appliedDesign = {
        id: randomUUID(),
        recipeId,
        revision: 1,
        recipeTemplateRevision: null,
        sourceTemplateId: null,
        sourceTemplateRevision: null,
        createdAt: tagTimestamp,
        updatedAt: tagTimestamp,
        value: {
          version: 1,
          layout: 'hearth',
          layoutVersion: 1,
          layoutAlgorithmVersion: 1,
          elements: [],
          theme: {
            ...DEFAULT_RECIPE_THEME,
            mode: 'dark',
            palette: {
              ...DEFAULT_RECIPE_THEME.palette,
              background: '#151515',
              surface: '#202020',
              text: '#ffffff',
            },
          },
        },
      };
      return structuredClone(appliedDesign);
    },
    photosUnavailable: (value: boolean) => {
      photosUnavailable = value;
    },
    addPhotoSeries: () => {
      if (!remote?.steps[0]) throw new Error('A saved step is required.');
      remote = {
        ...remote,
        recipe: { ...remote.recipe, revision: remote.recipe.revision + 1 },
        photos: [
          { ...coverPhoto, id: randomUUID(), kind: 'step', stepId: remote.steps[0].id },
          { ...coverPhoto, id: randomUUID(), kind: 'gallery', stepId: null },
        ],
      };
    },
    settings: () => settings,
    block: (value: boolean) => {
      blocked = value;
    },
    readOnly: () => {
      readonly = true;
    },
    account: (value: string) => {
      subject = value;
    },
    addCover: () => {
      includeCover = true;
      if (remote) remote = { ...remote, photos: [coverPhoto] };
    },
    makeRecipeLong: () => {
      if (!remote) throw new Error('A saved recipe is required.');
      remote = {
        ...remote,
        recipe: {
          ...remote.recipe,
          description: `${'Первый абзац семейной истории про яблочный пирог. '.repeat(24)}\n\n${'Второй абзац сохраняет подробности подачи и сезона. '.repeat(20)}`,
          notes: 'Семейная заметка должна сохраниться целиком.\n'.repeat(56),
          revision: remote.recipe.revision + 1,
        },
        steps: remote.steps.map((step, index) =>
          index === 3
            ? {
                ...step,
                body: `${'Выпекайте пирог и проверяйте золотистую корочку. '.repeat(34)}\n\n${'Оставьте пирог отдохнуть перед подачей. '.repeat(24)}`,
              }
            : step,
        ),
      };
    },
    delayPhotos: (milliseconds: number) => {
      photoDelay = milliseconds;
    },
    delayTemplates: (milliseconds: number) => {
      templateDelay = milliseconds;
    },
    loseNextTemplateMutationResponse: () => {
      loseNextTemplateMutationResponse = true;
    },
    failNextTemplateRefresh: () => {
      failNextTemplateRefresh = true;
    },
    delayNextRestoreResponse: () => {
      if (restoreResponseDelay) throw new Error('A restore response is already delayed.');
      let markStarted: () => void = () => undefined;
      let release: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      restoreResponseDelay = { started: markStarted, response };
      return { started, release };
    },
    changeRemote: () => {
      if (remote)
        remote = {
          ...remote,
          recipe: {
            ...remote.recipe,
            title: 'Версия с другого устройства',
            revision: remote.recipe.revision + 1,
            updatedAt: new Date().toISOString(),
          },
        };
    },
    requireRecipeInitialization: () => {
      recipeReady = false;
    },
  };
}
async function login(page: Page) {
  await page.getByRole('button', { name: 'Google (тест)' }).click();
}
async function create(page: Page) {
  await page.goto('/');
  await login(page);
  await page.getByRole('button', { name: 'Новый рецепт' }).click();
  await expect(page.getByLabel('Название', { exact: true })).toBeVisible();
}
async function openRecipeMode(page: Page, name: 'Просмотр' | 'Содержание' | 'Дизайн' | 'История') {
  await page.getByRole('tab', { name, exact: true }).click();
}
const saved = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Сохранено на сервере и на устройстве.' });

test('owner initializes recipe storage only after explicit confirmation', async ({ page }) => {
  const f = await fixture(page);
  f.requireRecipeInitialization();
  await page.goto('/');
  await login(page);
  await expect(page.getByRole('heading', { name: 'Рецепты в тетради' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('явного подтверждения');
  expect(
    f.commands.filter((command) => command.action === 'admin.recipes.initialize'),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Подготовить хранение рецептов' }).click();
  await expect
    .poll(
      () => f.commands.filter((command) => command.action === 'admin.recipes.initialize').length,
    )
    .toBe(1);
});

test('synchronizes profile and editor preferences, shortcuts, help and mobile layout', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto('/');
  await login(page);
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  const preferences = page.getByRole('region', { name: 'Профиль и редактор' });
  await expect(preferences.getByLabel('Имя в Tastory')).toHaveValue('Повар');
  await preferences.getByLabel('Имя в Tastory').fill('Шеф Мария');
  await preferences.getByLabel('Единицы').selectOption('imperial');
  await preferences.getByLabel('Новый рецепт').selectOption('workspace');
  await preferences.getByLabel('Плотность редактора').selectOption('compact');
  await preferences.getByLabel('Автосохранение').selectOption('500');
  await preferences.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(preferences.getByRole('status')).toContainText('Настройки сохранены');
  expect(f.settings()).toMatchObject({
    displayName: 'Шеф Мария',
    unitSystem: 'imperial',
    defaultVisibility: 'workspace',
    editorDensity: 'compact',
    autosaveDelay: 500,
  });

  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await page.getByRole('button', { name: 'Новый рецепт' }).click();
  await expect(page.getByLabel('Видимость', { exact: true })).toHaveValue('workspace');
  await page.keyboard.press('Alt+Shift+KeyI');
  await expect(page.getByLabel('Ингредиент 1', { exact: true })).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Как работать с Tastory' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Как работать с Tastory' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('previews and imports a portable recipe, then exports the book', async ({ page }) => {
  const f = await fixture(page);
  await page.goto('/');
  await login(page);
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  const sourceId = randomUUID();
  await page.getByLabel('Выбрать файл для импорта').setInputFiles({
    name: 'recipe.tastory.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'tastory.recipe-book',
        version: 1,
        kind: 'recipe',
        exportedAt: new Date().toISOString(),
        recipes: [
          {
            sourceId,
            sourceRevision: 1,
            visibility: 'workspace',
            status: 'draft',
            content: {
              title: 'Импортированный суп',
              description: 'Из переносимого файла',
              servings: 2,
              prepMinutes: 5,
              cookMinutes: 20,
              sourceUrl: '',
              notes: '',
            },
            ingredients: [],
            steps: [],
            tags: [],
            photos: [],
          },
        ],
      }),
    ),
  });
  const transfer = page.getByRole('region', { name: 'Импорт и экспорт' });
  await expect(transfer.getByRole('heading', { name: 'Предварительный просмотр' })).toBeVisible();
  await expect(transfer).toContainText('рецептов: 1');
  await transfer.getByRole('button', { name: 'Импортировать после проверки' }).click();
  await expect(transfer.getByRole('status')).toContainText('Импорт завершён');
  expect(f.remote()?.recipe).toMatchObject({ title: 'Импортированный суп', visibility: 'private' });
  const download = page.waitForEvent('download');
  await transfer.getByRole('button', { name: 'Экспортировать книгу с файлами' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^tastory-book-.*\.tastory\.json$/);
});

test('opens builtin sticker packs and places a sticker on a saved recipe', async ({ page }) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Рецепт со стикером');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');

  const packs = page.getByRole('region', { name: 'Стикер-паки' });
  await expect(packs.getByRole('tab', { name: /Уютная кухня/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const jam = packs.locator('article').filter({ hasText: 'Клубничное варенье' });
  await jam.getByRole('button', { name: 'На страницу' }).click();
  await expect(packs.getByRole('status')).toContainText('Стикер добавлен на страницу');
  await expect(
    packs.getByRole('button', { name: 'Выбрать стикер Клубничное варенье' }),
  ).toBeVisible();
  const designSticker = page.locator('.template-stage [data-page-sticker]');
  await expect(designSticker).toHaveCount(1);
  await expect(designSticker.locator('img')).toHaveAttribute('src', /stickers\/builtin\/jam\.png$/);

  await openRecipeMode(page, 'Просмотр');
  const bookSticker = page.locator(
    '.recipe-book-view .recipe-page-spread > .recipe-page-sheet [data-page-sticker]',
  );
  await expect(bookSticker).toHaveCount(1);
  await expect(bookSticker.locator('img')).toHaveAttribute('src', /stickers\/builtin\/jam\.png$/);
});

test('keeps sticker geometry on the recipe after reload and in A4', async ({ page }, testInfo) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Домашнее клубничное варенье');
  await page.getByLabel('Описание').fill('Семейный рецепт с сохранённой иллюстрацией.');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const packs = page.getByRole('region', { name: 'Стикер-паки' });
  await packs
    .locator('article')
    .filter({ hasText: 'Клубничное варенье' })
    .getByRole('button', { name: 'На страницу' })
    .click();
  await expect(packs.getByRole('status')).toContainText('Стикер добавлен');
  await packs.getByRole('button', { name: 'Повернуть по часовой стрелке' }).click();
  await expect(packs.getByRole('status')).toContainText('Поворот сохранён');
  const expected = f.placements()[0];
  expect(expected?.rotation).toBe(15);
  const design = page.locator('.template-stage [data-page-sticker]');
  await expect(design).toHaveCSS('transform', /matrix/);
  await expect(page.locator('.template-stage .recipe-page-spread')).toHaveAttribute(
    'data-layout-status',
    'ready',
  );
  const renderedGeometry = () =>
    page.locator('[data-page-sticker]').evaluate((sticker) => {
      const pageElement = sticker.closest('[data-document-page]');
      if (!pageElement) throw new Error('Sticker must belong to a document page.');
      const sheet = pageElement.getBoundingClientRect();
      const bounds = sticker.getBoundingClientRect();
      return [
        (bounds.left - sheet.left) / sheet.width,
        (bounds.top - sheet.top) / sheet.height,
        bounds.width / sheet.width,
        bounds.height / sheet.height,
      ];
    });
  const designGeometry = await renderedGeometry();
  const expectSameRenderedGeometry = async () => {
    const actual = await renderedGeometry();
    actual.forEach((value, index) => {
      const expectedValue = designGeometry[index];
      if (expectedValue === undefined) throw new Error('Missing reference geometry.');
      expect(Math.abs(value - expectedValue)).toBeLessThan(0.002);
    });
  };
  await page
    .locator('.template-stage')
    .screenshot({ path: testInfo.outputPath('stickers-design.png') });
  const geometry = async () =>
    page.locator('.recipe-book-view [data-page-sticker]').evaluate((element) => {
      const sticker = element as HTMLElement;
      const sheet = sticker.closest('[data-document-page]') as HTMLElement;
      return {
        pageId: sheet.dataset['documentPage'],
        left: sticker.style.left,
        top: sticker.style.top,
        width: sticker.style.width,
        height: sticker.style.height,
        rotation: sticker.style.transform,
        zIndex: sticker.style.zIndex,
      };
    });
  await openRecipeMode(page, 'Просмотр');
  await expect(page.locator('.recipe-book-view [data-page-sticker]')).toBeVisible();
  await expectSameRenderedGeometry();
  const before = await geometry();
  expect(before).toEqual({
    pageId: 'page-1',
    left: '8%',
    top: '8%',
    width: '18%',
    height: '18%',
    rotation: 'rotate(15deg)',
    zIndex: '100',
  });
  await page.reload();
  await login(page);
  await expect(page.locator('.recipe-book-view [data-page-sticker]')).toBeVisible();
  expect(await geometry()).toEqual(before);
  await expectSameRenderedGeometry();
  await expect
    .poll(() =>
      page.locator('.recipe-book-view .recipe-page-sheet').evaluate((sheet) => {
        const bounds = sheet.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= window.innerWidth;
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page
    .locator('.recipe-book-view .recipe-page-spread')
    .screenshot({ path: testInfo.outputPath('stickers-reopened.png') });
  await page.emulateMedia({ media: 'print' });
  expect(await geometry()).toEqual(before);
  await expectSameRenderedGeometry();
  await page
    .locator('.recipe-page-sheet')
    .screenshot({ path: testInfo.outputPath('stickers-a4.png') });
  expect(f.placements()).toHaveLength(1);
});

test('retains a sticker whose page disappeared until the author explicitly rebinds it', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Рецепт с продолжением');
  await page
    .getByLabel('Личные заметки', { exact: true })
    .fill('Длинная заметка о приготовлении. '.repeat(70));
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const packs = page.getByRole('region', { name: 'Стикер-паки' });
  await expect(packs.getByLabel('Страница для нового стикера').locator('option')).not.toHaveCount(
    1,
  );
  await packs.getByLabel('Страница для нового стикера').selectOption('page-2');
  await packs
    .locator('article')
    .filter({ hasText: 'Клубничное варенье' })
    .getByRole('button', { name: 'На страницу' })
    .click();
  await expect(packs.getByRole('status')).toContainText('Стикер добавлен');
  const id = f.placements()[0]?.id;
  await openRecipeMode(page, 'Содержание');
  await page.getByRole('textbox', { name: 'Личные заметки', exact: true }).fill('');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Просмотр');
  await expect(page.locator('.recipe-page-spread').getByRole('alert')).toContainText(
    'страница больше не существует',
  );
  await expect(page.locator('[data-page-sticker]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeDisabled();
  expect(f.placements()).toMatchObject([{ id, page: 2 }]);
  await openRecipeMode(page, 'Дизайн');
  await packs.getByLabel('Страница выбранного стикера').selectOption('page-1');
  await expect(packs.getByRole('status')).toContainText('Привязка к странице сохранена');
  await expect(page.locator('.template-stage [data-page-sticker]')).toBeVisible();
  expect(f.placements()).toMatchObject([{ id, page: 1 }]);
});

test('loads step photos and gallery into bounded photo pages and retries unavailable files', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Пирог по шагам');
  await page.getByRole('button', { name: 'Добавить шаг' }).click();
  await page
    .getByLabel('Шаг 1', { exact: true })
    .fill('Смешайте ингредиенты и выпекайте до готовности.');
  await expect(saved(page)).toBeVisible();
  f.addPhotoSeries();
  f.photosUnavailable(true);
  await page.reload();
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Оформление загружено не полностью');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeDisabled();
  f.photosUnavailable(false);
  await page.getByRole('button', { name: 'Повторить загрузку изображений' }).click();
  await expect(page.locator('[data-photo-kind="step"]')).toHaveCount(1);
  await expect(page.locator('[data-photo-kind="gallery"]')).toHaveCount(1);
  await expect(page.locator('[data-photo-kind="step"] img')).toHaveAttribute(
    'alt',
    'Пирог по шагам — Шаг 1 · фото 1',
  );
  await expect(page.locator('[data-photo-kind="step"] img')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.recipe-page-spread')).toHaveAttribute('data-layout-status', 'ready');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeEnabled();
  await page.emulateMedia({ media: 'print' });
  await page
    .locator('[data-page-kind="photos"]')
    .first()
    .screenshot({ path: testInfo.outputPath('step-photo-a4.png') });
  const pdf = await page.pdf({
    path: testInfo.outputPath('photos.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(
    await page.locator('.recipe-page-sheet').count(),
  );
});

test('uses legacy and reference-led recipe templates and copies a shared style into the personal library', async ({
  page,
}) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Лимонный тарт');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');

  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await expect(library.locator('.template-card')).toHaveCount(15);
  await library.getByRole('button', { name: 'Напитки' }).click();
  await expect(library.locator('.template-card')).toHaveCount(6);

  const coffeehouse = library.locator('.template-card').filter({ hasText: 'Домашняя кофейня' });
  await coffeehouse.getByRole('button', { name: 'Применить' }).click();
  await expect(library.getByRole('status')).toContainText('Домашняя кофейня');
  await expect(library.locator('.template-stage .template-recipe-page')).toHaveAttribute(
    'data-layout',
    'coffeehouse',
  );

  await library.getByRole('button', { name: 'От участников' }).click();
  const shared = library.locator('.template-card').filter({ hasText: 'Летний аперитив' });
  await shared.getByRole('button', { name: 'Сохранить себе' }).click();
  await expect(library.getByRole('status')).toContainText('сохранён в вашей библиотеке');
  await library.getByRole('button', { name: 'Мои' }).click();
  await expect(library.getByRole('heading', { name: 'Летний аперитив — моя' })).toBeVisible();

  await library.getByText('Дополнительно: создать свой шаблон').click();
  const creator = library.locator('.template-create');
  await creator.getByLabel('Название шаблона').fill('Мой семейный обед');
  await creator.getByLabel('Основа').selectOption('notebook');
  await creator.getByLabel('Описание').fill('Страница для семейных рецептов');
  await creator.getByLabel('Доступ').selectOption('workspace');
  await creator.getByRole('button', { name: 'Создать шаблон' }).click();
  await expect(library.getByRole('heading', { name: 'Мой семейный обед' })).toBeVisible();
});

const n4Families = [
  ['pastel-notebook', 'Пастельный блокнот'],
  ['berry-diary', 'Ягодный дневник'],
  ['lined-notebook', 'Линованная тетрадь'],
  ['clean-card', 'Чистая карточка'],
] as const;
const n4ScreenshotStyle = `
  .recipe-page-heading,
  .recipe-toolbar,
  .recipe-editor-mode-tabs,
  .recipe-book-actions { visibility: hidden !important; }
`;

for (const [layout, name] of n4Families) {
  test(`N4 renders ${name} for short and long content at review sizes`, async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chromium';
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 });
    const f = await fixture(page);
    await create(page);
    f.addCover();
    await page.getByLabel('Название', { exact: true }).fill('Семейный яблочный пирог');
    await page
      .getByLabel('Описание')
      .fill('Хрустящее тесто, сезонные яблоки и заметки из семейной тетради.');
    await page.getByLabel('Источник', { exact: true }).fill('https://example.test/apple-pie');
    await page.getByLabel('Выпечка', { exact: true }).check();
    for (const [index, name] of [
      'Яблоки',
      'Мука',
      'Сливочное масло',
      'Сахар',
      'Корица',
    ].entries()) {
      await page.getByRole('button', { name: 'Добавить ингредиент' }).click();
      await page.getByLabel(`Ингредиент ${index + 1}`, { exact: true }).fill(name);
    }
    for (const [index, body] of [
      'Нарежьте яблоки тонкими дольками.',
      'Замесите мягкое тесто и дайте ему отдохнуть.',
      'Соберите пирог и посыпьте корицей.',
      'Выпекайте до золотистой корочки.',
    ].entries()) {
      await page.getByRole('button', { name: 'Добавить шаг' }).click();
      await page.getByLabel(`Шаг ${index + 1}`, { exact: true }).fill(body);
    }
    await page.getByLabel('Личные заметки').fill('Подавайте пирог тёплым.');
    await expect(saved(page)).toBeVisible();

    const capture = async (length: 'short' | 'long') => {
      if (length === 'short') {
        await openRecipeMode(page, 'Дизайн');
        const library = page.getByRole('region', { name: 'Шаблоны страниц' });
        const card = library.locator('.template-card').filter({ hasText: name });
        await card.getByRole('button', { name: 'Применить' }).click();
        await expect(library.locator('.template-notice-success')).toContainText(name);
      }
      await openRecipeMode(page, 'Просмотр');
      const spread = page.locator('.recipe-book-view .recipe-page-spread');
      await expect(spread).toHaveAttribute('data-layout-status', 'ready');
      const sheets = spread.locator(':scope > .recipe-page-sheet');
      await expect(sheets.first()).toHaveAttribute('data-layout', layout);
      await expect(sheets.first().getByAltText(/Главная фотография рецепта/)).toBeVisible();
      if (length === 'long') {
        expect(await sheets.count()).toBeGreaterThan(1);
        await expect(spread).toContainText('Оставьте пирог отдохнуть перед подачей.');
        await expect(sheets.last()).toContainText('Семейная заметка должна сохраниться целиком.');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await sheets.first().screenshot({
        path: testInfo.outputPath(
          `${layout}-${length}-${mobile ? 'mobile-390' : 'desktop-1440'}.png`,
        ),
        style: n4ScreenshotStyle,
      });
      if (mobile) {
        await page.setViewportSize({ width: 320, height: 740 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await sheets.first().screenshot({
          path: testInfo.outputPath(`${layout}-${length}-mobile-320.png`),
          style: n4ScreenshotStyle,
        });
        await page.setViewportSize({ width: 390, height: 844 });
      } else {
        await page.emulateMedia({ media: 'print' });
        await sheets.first().screenshot({
          path: testInfo.outputPath(`${layout}-${length}-a4-first.png`),
          style: n4ScreenshotStyle,
        });
        if (length === 'long')
          await sheets.last().screenshot({
            path: testInfo.outputPath(`${layout}-${length}-a4-last.png`),
            style: n4ScreenshotStyle,
          });
        await page.emulateMedia({ media: 'screen' });
      }
    };

    await capture('short');
    f.makeRecipeLong();
    await page.reload();
    await login(page);
    await expect(page.getByRole('tab', { name: 'Просмотр', exact: true })).toBeVisible();
    await capture('long');
  });
}

test('N7 edits one composition gesture as one command and supports keyboard undo reload', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Пирог для редактора композиции');
  await page.getByLabel('Описание').fill('Проверяем управляемое положение текстового блока.');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');

  const editor = page.getByRole('region', { name: 'Шаблоны страниц' });
  const canvas = editor.getByLabel(/Лист рецепта\. Стрелки/);
  await expect(canvas).toBeVisible();
  await editor.getByRole('button', { name: 'Название', exact: true }).first().click();
  const title = editor.locator('[data-composition-key="content:title"]').first();
  await expect(title).toHaveClass(/is-composition-selected/);
  const before = await title.getAttribute('style');
  const writesBefore = f.commands.filter((item) => item.action === 'recipes.design.save').length;
  const properties = editor.getByLabel('Свойства элемента');
  await properties.getByLabel('Ширина, %').fill('12');
  await properties.getByLabel('Высота, %').fill('4');
  await properties.getByRole('button', { name: 'Применить' }).click();
  await expect(editor.getByRole('alert')).toContainText('не вмещает весь текст');
  expect(f.commands.filter((item) => item.action === 'recipes.design.save')).toHaveLength(
    writesBefore,
  );
  await expect(title).toHaveAttribute('style', before ?? '');
  await expect(editor.locator('.recipe-page-spread').first()).toHaveAttribute(
    'data-layout-status',
    'ready',
  );
  await expect(title.locator('xpath=ancestor::*[@data-document-page][1]')).toHaveAttribute(
    'data-composition-editable',
    'true',
  );
  if (testInfo.project.name === 'mobile-chromium') {
    const bounds = await title.boundingBox();
    if (!bounds) throw new Error('Title geometry is unavailable.');
    const point = {
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    };
    await title.dispatchEvent('pointerdown', {
      ...point,
      pointerId: 73,
      pointerType: 'touch',
      isPrimary: true,
      buttons: 1,
    });
    await canvas.dispatchEvent('pointermove', {
      clientX: point.clientX - 36,
      clientY: point.clientY + 24,
      pointerId: 73,
      pointerType: 'touch',
      isPrimary: true,
      buttons: 1,
    });
    await canvas.dispatchEvent('pointerup', {
      clientX: point.clientX - 36,
      clientY: point.clientY + 24,
      pointerId: 73,
      pointerType: 'touch',
      isPrimary: true,
      buttons: 0,
    });
  } else {
    let bounds = await title.boundingBox();
    if (!bounds) throw new Error('Title geometry is unavailable.');
    let dragY = bounds.y + bounds.height - 12;
    await page.mouse.move(bounds.x + bounds.width / 2, dragY);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 20, dragY + 12, { steps: 3 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    expect(f.commands.filter((item) => item.action === 'recipes.design.save')).toHaveLength(
      writesBefore,
    );
    await expect(title).toHaveAttribute('style', before ?? '');
    bounds = await title.boundingBox();
    if (!bounds) throw new Error('Title geometry is unavailable after cancelled drag.');
    dragY = bounds.y + bounds.height - 12;
    await page.mouse.move(bounds.x + bounds.width / 2, dragY);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 44, dragY + 28, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.design.save').length)
    .toBe(writesBefore + 1);
  await expect(title).not.toHaveAttribute('style', before ?? '');
  expect(f.design()?.value.elements.filter((item) => item.binding === 'title')).toHaveLength(1);

  await editor.getByRole('button', { name: 'Отменить' }).click();
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.design.save').length)
    .toBe(writesBefore + 2);
  await editor.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.design.save').length)
    .toBe(writesBefore + 3);
  await expect(editor.getByRole('button', { name: 'Отменить' })).toBeEnabled();

  await canvas.press('ArrowRight');
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.design.save').length)
    .toBe(writesBefore + 4);
  await expect(editor.getByRole('button', { name: 'Заблокировать' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Заблокировать' }).click();
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.design.save').length)
    .toBe(writesBefore + 5);
  await expect(editor.getByRole('button', { name: 'Разблокировать' })).toBeEnabled();
  await canvas.press('ArrowLeft');
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.design.save').length)
    .toBe(writesBefore + 5);
  const storedX = f.design()?.value.elements.find((item) => item.binding === 'title')?.x;
  expect(storedX).toBeGreaterThan(0);
  const storedStyle = await title.getAttribute('style');
  const sheet = title.locator('xpath=ancestor::*[@data-document-page][1]');
  const contained = await title.evaluate((element) => {
    const page = element.closest<HTMLElement>('[data-document-page]');
    if (!page) return false;
    const item = element.getBoundingClientRect();
    const frame = page.getBoundingClientRect();
    return (
      item.left >= frame.left - 1 &&
      item.top >= frame.top - 1 &&
      item.right <= frame.right + 1 &&
      item.bottom <= frame.bottom + 1
    );
  });
  expect(contained).toBe(true);
  await sheet.screenshot({ path: testInfo.outputPath('n7-composition.png') });

  await page.reload();
  await login(page);
  await openRecipeMode(page, 'Дизайн');
  await editor.getByRole('button', { name: 'Название', exact: true }).first().click();
  await expect(title).toHaveAttribute('style', storedStyle ?? '');
  await expect(editor.getByRole('button', { name: 'Разблокировать' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('N7 edits decorative size rotation and layer through the shared renderer', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Карточка с декором');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const packs = page.getByRole('region', { name: 'Стикер-паки' });
  await packs
    .locator('article')
    .filter({ hasText: 'Клубничное варенье' })
    .getByRole('button', { name: 'На страницу' })
    .click();
  await expect(packs.getByRole('status')).toContainText('Стикер добавлен');

  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await expect(library.locator('.template-stage [data-page-sticker]')).toBeVisible();
  await library
    .getByRole('button', { name: /Клубничное варенье/ })
    .first()
    .click();
  const properties = library.getByLabel('Свойства элемента');
  await properties.getByLabel('Ширина, %').fill('22');
  await properties.getByLabel('Высота, %').fill('16');
  await properties.getByLabel('Поворот').fill('30');
  await properties.getByLabel('Слой').fill('4');
  const before = f.commands.filter((item) => item.action === 'recipes.stickers.update').length;
  await properties.getByRole('button', { name: 'Применить' }).click();
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.stickers.update').length)
    .toBe(before + 1);
  expect(f.placements()[0]).toMatchObject({ width: 22, height: 16, rotation: 30, zIndex: 4 });
  await expect(library.locator('.template-stage [data-page-sticker]')).toHaveCSS(
    'transform',
    /matrix/,
  );

  await library.getByRole('button', { name: 'Отменить' }).click();
  await expect
    .poll(() => f.commands.filter((item) => item.action === 'recipes.stickers.update').length)
    .toBe(before + 2);
  expect(f.placements()[0]).toMatchObject({ width: 18, height: 18, rotation: 0, zIndex: 0 });
});

test('N7 safely repeats an unknown composition save after reload', async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Команда после перезагрузки');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await library.getByRole('button', { name: 'Название', exact: true }).first().click();
  const properties = library.getByLabel('Свойства элемента');
  const x = properties.getByLabel('X, %');
  await x.fill(String(Number(await x.inputValue()) - 1));
  f.loseNextTemplateMutationResponse();
  await properties.getByRole('button', { name: 'Применить' }).click();
  await expect(library.getByRole('alert')).toContainText('Не удалось связаться с сервером');
  const first = f.commands.filter((item) => item.action === 'recipes.design.save').at(-1);
  expect(first?.requestId).toBeTruthy();

  await page.reload();
  await login(page);
  await openRecipeMode(page, 'Дизайн');
  await expect(library.locator('.composition-save-state')).toContainText(
    'Есть локальная версия композиции',
  );
  await library.getByRole('button', { name: 'Сохранить локальные изменения' }).click();
  await expect(library.getByRole('button', { name: 'Сохранить локальные изменения' })).toHaveCount(
    0,
  );
  const saves = f.commands.filter((item) => item.action === 'recipes.design.save');
  expect(saves.map((item) => item.requestId)).toEqual([first?.requestId, first?.requestId]);
  expect(f.design()?.revision).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'private-recipe-test-token',
  );
});

test('N7 preserves a local composition on conflict until the author chooses the server copy', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Конфликт композиции');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await library.getByRole('button', { name: 'Название', exact: true }).first().click();
  const properties = library.getByLabel('Свойства элемента');
  const x = properties.getByLabel('X, %');
  await x.fill(String(Number(await x.inputValue()) - 1));
  await properties.getByRole('button', { name: 'Применить' }).click();
  await expect(library.getByRole('button', { name: 'Заблокировать' })).toBeEnabled();
  const remote = f.advanceDesign();

  await x.fill(String(Number(await x.inputValue()) - 2));
  await properties.getByRole('button', { name: 'Применить' }).click();
  await expect(library.getByRole('alert')).toContainText('Оформление изменено');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toContain(
    'tastory.composition-draft.v1',
  );
  const localLeft = await library
    .locator('[data-composition-key="content:title"]')
    .first()
    .evaluate((element) => (element as HTMLElement).style.left);
  expect(localLeft).not.toBe(
    `${remote.value.elements.find((item) => item.binding === 'title')?.x}%`,
  );

  await library.getByRole('button', { name: 'Принять серверную версию' }).click();
  await expect(library.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(() =>
      library
        .locator('[data-composition-key="content:title"]')
        .first()
        .evaluate((element) => (element as HTMLElement).style.left),
    )
    .toBe(`${remote.value.elements.find((item) => item.binding === 'title')?.x}%`);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'tastory.composition-draft.v1',
  );
});

test('replays a lost template creation after reload without creating a duplicate', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Каша');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await library.getByText('Дополнительно: создать свой шаблон').click();
  const creator = library.locator('.template-create');
  await creator.getByLabel('Название шаблона').fill('Тихий завтрак');
  await creator.getByLabel('Описание').fill('Поля переживают неизвестный результат');
  f.loseNextTemplateMutationResponse();
  await creator.getByRole('button', { name: 'Создать шаблон' }).click();
  await expect(library.getByRole('alert')).toContainText('Не удалось связаться с сервером');
  await expect(creator.getByLabel('Название шаблона')).toHaveValue('Тихий завтрак');
  const firstRequestId = f.commands
    .filter((item) => item.action === 'templates.create')
    .at(-1)?.requestId;
  expect(firstRequestId).toBeTruthy();

  await page.reload();
  await login(page);
  await openRecipeMode(page, 'Дизайн');
  await library.getByText('Дополнительно: создать свой шаблон').click();
  await expect(creator.getByLabel('Название шаблона')).toHaveValue('Тихий завтрак');
  await expect(creator.getByLabel('Описание')).toHaveValue('Поля переживают неизвестный результат');
  await creator.getByRole('button', { name: 'Создать шаблон' }).click();
  await expect(library.getByRole('status')).toContainText('добавлен в вашу библиотеку');
  await expect(library.getByRole('heading', { name: 'Тихий завтрак' })).toHaveCount(1);
  const createRequests = f.commands.filter((item) => item.action === 'templates.create');
  expect(createRequests.map((item) => item.requestId)).toEqual([firstRequestId, firstRequestId]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'private-recipe-test-token',
  );
});

test('replays a lost recipe design apply after reload without creating another revision', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Кофейный пирог');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  const coffeehouse = library.locator('.template-card').filter({ hasText: 'Домашняя кофейня' });
  f.loseNextTemplateMutationResponse();
  await coffeehouse.getByRole('button', { name: 'Применить' }).click();
  await expect(library.getByRole('alert')).toContainText('Не удалось связаться с сервером');
  const first = f.commands.filter((item) => item.action === 'recipes.template.apply').at(-1);
  expect(first?.requestId).toBeTruthy();

  await page.reload();
  await login(page);
  await openRecipeMode(page, 'Дизайн');
  await expect(library.locator('.template-stage .template-recipe-page')).toHaveAttribute(
    'data-layout',
    'coffeehouse',
  );
  await coffeehouse.getByRole('button', { name: 'Применить снова' }).click();
  await expect(library.getByRole('status')).toContainText('Домашняя кофейня');
  const applies = f.commands.filter((item) => item.action === 'recipes.template.apply');
  expect(applies.map((item) => item.requestId)).toEqual([first?.requestId, first?.requestId]);
});

test('reports refresh failure after a committed template without offering the create again', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Суп');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await library.getByText('Дополнительно: создать свой шаблон').click();
  const creator = library.locator('.template-create');
  await creator.getByLabel('Название шаблона').fill('Обеденная карточка');
  f.failNextTemplateRefresh();
  await creator.getByRole('button', { name: 'Создать шаблон' }).click();

  await expect(library.getByRole('status')).toContainText('добавлен в вашу библиотеку');
  await expect(library.getByRole('alert')).toContainText(
    'Изменение сохранено, но библиотеку не удалось обновить',
  );
  await expect(creator.getByLabel('Название шаблона')).toHaveValue('');
  expect(f.commands.filter((item) => item.action === 'templates.create')).toHaveLength(1);
});

test('N6 print waits for decoded photos and refuses unavailable saved design', async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  f.addCover();
  await page.getByLabel('Название', { exact: true }).fill('Проверка готовности печати');
  await expect(saved(page)).toBeVisible();
  const gate = f.holdPhotos();
  await openRecipeMode(page, 'Просмотр');
  await gate.waiting;
  await expect(page.locator('.recipe-book-view')).toHaveAttribute('data-print-ready', 'false');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeDisabled();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.recipe-print-blocked')).toBeVisible();
  await expect(page.locator('.recipe-page-sheet').first()).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  gate.release();
  await expect(page.locator('.recipe-book-view')).toHaveAttribute('data-print-ready', 'true');
  expect(
    await page
      .locator('.recipe-page-sheet img')
      .evaluateAll((images) =>
        images.every(
          (image) =>
            (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  f.designUnavailable(true);
  await page.reload();
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Сохранённое оформление недоступно');
  await expect(page.locator('.recipe-page-sheet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeDisabled();
  f.designUnavailable(false);
  await page.getByRole('button', { name: 'Повторить загрузку оформления' }).click();
  await expect(page.locator('.recipe-book-view')).toHaveAttribute('data-print-ready', 'true');
  await openRecipeMode(page, 'Содержание');
  await page.evaluate(() => {
    document.fonts.load = () => Promise.reject(new Error('Fixture font download failed.'));
  });
  await openRecipeMode(page, 'Просмотр');
  await expect(page.getByRole('alert')).toContainText('Шрифты или изображения не готовы');
  await expect(page.locator('.recipe-page-spread')).toHaveAttribute('data-layout-status', 'error');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeDisabled();
  await page.getByRole('button', { name: 'Перезагрузить страницу и повторить' }).click();
  await login(page);
  await expect(page.locator('.recipe-book-view')).toHaveAttribute('data-print-ready', 'true');
});

test('N6 print produces complete physical A4 pages with a light paper profile', async ({
  page,
  browserName,
}, testInfo) => {
  const f = await fixture(page);
  await create(page);
  f.addCover();
  await page
    .getByLabel('Название', { exact: true })
    .fill('Синтетический рецепт для проверки печати');
  await page.getByLabel('Описание').fill('Первый абзац описания.\n\nВторой абзац описания.');
  await page
    .getByLabel('Источник', { exact: true })
    .fill('https://example.test/recipe-attribution');
  await page.getByRole('button', { name: 'Добавить шаг' }).click();
  await page.getByLabel('Шаг 1', { exact: true }).fill('Размешивайте смесь ровно указанное время.');
  const paragraphs = Array.from(
    { length: 48 },
    (_, index) =>
      `N6-P${String(index + 1).padStart(3, '0')} Значимый абзац: сохраните продукты, последовательность приготовления и семейные заметки.`,
  );
  await page.getByLabel('Личные заметки', { exact: true }).fill(paragraphs.join('\n\n'));
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  await page
    .getByRole('region', { name: 'Стикер-паки' })
    .locator('article')
    .filter({ hasText: 'Клубничное варенье' })
    .getByRole('button', { name: 'На страницу' })
    .click();
  await expect(page.getByRole('region', { name: 'Стикер-паки' }).getByRole('status')).toContainText(
    'Стикер добавлен',
  );
  const savedDesign = f.preparePrint();
  await page.reload();
  await login(page);
  await openRecipeMode(page, 'Просмотр');
  const book = page.locator('.recipe-book-view');
  await expect(book).toHaveAttribute('data-print-ready', 'true');
  await expect(book).toHaveAttribute('data-print-content', 'saved');
  const theme = page.locator('.recipe-book-view .recipe-presentation-theme');
  await expect(theme).toHaveAttribute('data-mode', 'dark');
  const originalStyle = await theme.getAttribute('style');
  const pages = page.locator('.recipe-page-sheet');
  const count = await pages.count();
  expect(count).toBeGreaterThan(1);
  const fragments = await page.locator('.recipe-page-sheet [data-source-key]').allTextContents();
  await expect(book).toContainText('(30 сек)');
  await expect(book).not.toContainText('(1 мин)');
  await page.emulateMedia({ media: 'print' });
  await expect(theme).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(pages.first()).toHaveCSS('color', 'rgb(36, 31, 26)');
  await expect(pages.first().locator('h3')).toHaveCSS('font-size', '68px');
  await expect(page.locator('.recipe-toolbar')).toBeHidden();
  await expect(page.locator('.recipe-editor-mode-tabs')).toBeHidden();
  await expect(page.locator('.recipe-book-actions')).toBeHidden();
  expect(
    await pages.evaluateAll((elements) =>
      elements.every((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          Math.abs(bounds.width - (210 * 96) / 25.4) < 1 &&
          Math.abs(bounds.height - (297 * 96) / 25.4) < 2
        );
      }),
    ),
  ).toBe(true);
  await pages.first().screenshot({ path: testInfo.outputPath('print-first-page.png') });
  await pages.last().screenshot({ path: testInfo.outputPath('print-last-page.png') });
  if (browserName === 'chromium') {
    const path = testInfo.outputPath('verified-recipe.pdf');
    await page.pdf({ path, format: 'A4', printBackground: true, preferCSSPageSize: true });
    const inspected = JSON.parse(
      execFileSync(
        process.env['TASTORY_PDF_PYTHON'] ?? (process.platform === 'win32' ? 'python' : 'python3'),
        ['scripts/inspect-recipe-pdf.py', path],
        { encoding: 'utf8' },
      ),
    ) as { text: string; width: number; height: number; images: number; links: string[] }[];
    expect(inspected).toHaveLength(count);
    const normalize = (text: string) => text.replace(/\s+/g, '');
    const text = normalize(inspected.map((item) => item.text).join(''));
    for (const fragment of fragments) expect(text).toContain(normalize(fragment));
    for (const paragraph of paragraphs) expect(text.split(normalize(paragraph))).toHaveLength(2);
    inspected.forEach((item, index) => {
      expect(Math.abs(item.width - 595.28)).toBeLessThan(1);
      expect(Math.abs(item.height - 841.89)).toBeLessThan(1);
      expect(item.text.replace(/[\s\d]/g, '').length).toBeGreaterThan(25);
      expect(item.text).toContain(String(index + 1).padStart(2, '0'));
    });
    expect(inspected[0]?.images).toBeGreaterThanOrEqual(2);
    expect(inspected.flatMap((item) => item.links)).toContain(
      'https://example.test/recipe-attribution',
    );
    expect(text).not.toMatch(/Сохранитьсейчас|Печать\/PDF|Конфликт|Стикер-паки/);
  }
  await page.emulateMedia({ media: 'screen' });
  expect(await theme.getAttribute('style')).toBe(originalStyle);
  expect(savedDesign.value.theme.mode).toBe('dark');
  expect(f.commands.filter((command) => command.action === 'recipes.design.save')).toHaveLength(0);
});

test('N6 print labels the unsaved local content and excludes draft controls', async ({ page }) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Сохранённая версия');
  await expect(saved(page)).toBeVisible();
  f.block(true);
  await page.getByLabel('Название', { exact: true }).fill('Локальная версия для печати');
  await openRecipeMode(page, 'Просмотр');
  await expect(page.locator('.recipe-book-view')).toHaveAttribute(
    'data-print-content',
    'local-preview',
  );
  await expect(page.locator('.recipe-book-actions')).toContainText('несохранённые изменения');
  await expect(page.locator('.recipe-book-view')).toHaveAttribute('data-print-ready', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.recipe-page-sheet h3')).toHaveText('Локальная версия для печати');
  await expect(page.locator('.recipe-toolbar')).toBeHidden();
  await expect(page.locator('.recipe-book-actions')).toBeHidden();
});

test('opens a saved recipe as a book page and keeps editing in a separate mode', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await create(page);
  f.addCover();
  await page.getByLabel('Название', { exact: true }).fill('Семейный пирог');
  await page.getByLabel('Описание').fill('Тёплый рецепт для воскресного обеда.');
  await page.getByLabel('Источник', { exact: true }).fill('https://example.test/family-pie');
  await page.getByLabel('Выпечка', { exact: true }).check();
  await page.getByRole('button', { name: 'Добавить ингредиент' }).click();
  await page.getByLabel('Ингредиент 1', { exact: true }).fill('Яблоки');
  for (let stepIndex = 1; stepIndex <= 4; stepIndex += 1) {
    await page.getByRole('button', { name: 'Добавить шаг' }).click();
    await page
      .getByLabel(`Шаг ${stepIndex}`, { exact: true })
      .fill(
        stepIndex === 1
          ? 'Нарежьте яблоки и испеките пирог.'
          : `Дополнительный этап приготовления ${stepIndex}.`,
      );
  }
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');
  await expect(page.locator('.template-stage')).toContainText('Выпечка');
  await openRecipeMode(page, 'Просмотр');

  const sheet = page.getByRole('article', { name: /Страница 1: Семейный пирог/ });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-layout', 'hearth');
  await expect(sheet).toContainText('Яблоки');
  await expect(sheet).toContainText('Нарежьте яблоки');
  await expect(sheet).toContainText('Выпечка');
  await expect(sheet.getByRole('link', { name: 'Источник рецепта' })).toHaveAttribute(
    'href',
    'https://example.test/family-pie',
  );
  await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0);
  await expect(page.locator('.recipe-page-spread')).toHaveAttribute('data-layout-status', 'ready');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('recipe-book-view.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  f.delayPhotos(3000);
  f.delayTemplates(3000);
  await page.reload();
  await login(page);
  await expect(page.getByRole('tab', { name: 'Просмотр', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('article', { name: /Страница 1: Семейный пирог/ })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Печать / PDF' }).isDisabled()).toBe(true);
  await expect(
    page
      .locator('.recipe-book-view .recipe-page-spread > .recipe-page-sheet')
      .getByAltText('Главная фотография рецепта'),
  ).toBeVisible();
  f.delayPhotos(0);
  f.delayTemplates(0);
  await openRecipeMode(page, 'Дизайн');
  await expect(
    page.locator('.template-stage').getByAltText('Главная фотография рецепта'),
  ).toBeVisible();
  await expect(page.locator('.template-stage')).toContainText('Выпечка');
  await openRecipeMode(page, 'Просмотр');
  await expect(page.locator('.recipe-page-spread')).toHaveAttribute('data-layout-status', 'ready');
  await page.emulateMedia({ media: 'print' });
  await expect
    .poll(() =>
      page.locator('.app-header').evaluate((element) => getComputedStyle(element).display),
    )
    .toBe('none');
  const logicalPageCount = await page.locator('.recipe-page-spread > .recipe-page-sheet').count();
  const pdf = await page.pdf({
    path: testInfo.outputPath('recipe-book.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  const physicalPageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
  expect(physicalPageCount).toBe(logicalPageCount);
  await page.emulateMedia({ media: 'screen' });
  await openRecipeMode(page, 'Содержание');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Семейный пирог');
});

test('measures long paragraphs into exact fragments and keeps mobile semantic reflow', async ({
  page,
}, testInfo) => {
  await fixture(page);
  await create(page);
  const title = 'Большой семейный пирог для долгого воскресного обеда на веранде';
  const description = `${'Первый абзац семейной истории. '.repeat(45)}\n\n${'Второй абзац семейной истории. '.repeat(45)}`;
  const longStep = `${'Аккуратно перемешайте ингредиенты и сохраните текст шага. '.repeat(55)}\n\n${'Продолжайте готовить без потери следующего абзаца. '.repeat(35)}`;
  const notes = `${'Первая строка заметок.\n'.repeat(60)}\n${'Финальная строка заметок.\n'.repeat(45)}`;
  await page.getByLabel('Название', { exact: true }).fill(title);
  await page.getByLabel('Описание').fill(description);
  await page.getByRole('button', { name: 'Добавить шаг' }).click();
  await page.getByLabel('Шаг 1', { exact: true }).fill(longStep);
  await page.getByLabel('Личные заметки').fill(notes);
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Просмотр');

  const spread = page.locator('.recipe-page-spread');
  await expect(spread).toHaveAttribute('data-layout-measurement', 'measured');
  await expect(spread).toHaveAttribute('data-layout-status', 'ready');
  expect(await spread.locator(':scope > .recipe-page-sheet').count()).toBeGreaterThan(3);
  const joined = async (selector: string) =>
    (await spread.locator(selector).allTextContents()).join('');
  expect(await joined('[data-source-key="description"]')).toBe(description);
  expect(await joined('.recipe-page-list-step [data-source-key] .recipe-page-fragment-text')).toBe(
    longStep,
  );
  expect(await joined('[data-source-key="notes"]')).toBe(notes);

  const fragmentKeys = await spread
    .locator('[data-fragment-index]')
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          `${element.getAttribute('data-source-key')}:${element.getAttribute('data-source-start')}:${element.getAttribute('data-source-end')}`,
      ),
    );
  expect(new Set(fragmentKeys).size).toBe(fragmentKeys.length);
  const titleElement = spread.locator('[data-page-element="page-1-title"]');
  await expect(titleElement).toHaveAttribute('style', /left: 8%; top: 6%/);
  const position = await titleElement.evaluate((element) => getComputedStyle(element).position);
  expect(position).toBe(testInfo.project.name === 'mobile-chromium' ? 'relative' : 'absolute');
  if (testInfo.project.name === 'desktop-chromium') {
    const logicalPages = await spread.locator(':scope > .recipe-page-sheet').count();
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const physicalPages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(physicalPages).toBe(logicalPages);
    await page.emulateMedia({ media: 'screen' });
  }
});

test('blocks PDF when measured A4 content overflows its document element', async ({ page }) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('ОченьДлинноеНазвание'.repeat(10));
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Просмотр');

  await expect(page.locator('.recipe-page-spread')).toHaveAttribute(
    'data-layout-status',
    'overflow',
  );
  await expect(page.getByRole('alert')).toContainText('не помещаются на лист A4');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeDisabled();
});

test('library searches ingredients, keeps URL filters, switches view and stores personal favorites', async ({
  page,
}) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Яблочный пирог');
  await page.getByRole('button', { name: 'Добавить ингредиент' }).click();
  await page.getByLabel('Ингредиент 1', { exact: true }).fill('Кислые яблоки');
  await expect(saved(page)).toBeVisible();
  await page.getByRole('link', { name: 'Библиотека' }).click();
  const library = page.getByRole('region', { name: 'Рецепты в тетради' });
  await library.getByLabel('Поиск').fill('яблоки');
  await expect(library.getByRole('link', { name: 'Яблочный пирог', exact: true })).toBeVisible();
  await library.getByRole('button', { name: 'Список' }).click();
  await expect(page).toHaveURL(/view=list/);
  await library.getByRole('button', { name: 'Добавить в избранное' }).click();
  await library.getByText('Только избранное').click();
  await expect(page).toHaveURL(/favorite=1/);
  await page.reload();
  await login(page);
  await expect(library.getByRole('link', { name: 'Яблочный пирог', exact: true })).toBeVisible();
  await expect(library.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
});

test('N8 introduces the local book and keeps the content to layout to reading path clear', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await page.goto('/');
  await login(page);

  const guide = page.getByRole('region', { name: 'Соберите свою кулинарную книгу' });
  await expect(guide.getByText('Демонстрационный рецепт')).toBeVisible();
  await expect(guide.getByLabel('Локальный пример готовой страницы')).toContainText(
    'Яблочный пирог для воскресенья',
  );
  expect(
    f.commands.filter(
      (command) =>
        command.action === 'recipes.create' || command.action === 'admin.recipes.initialize',
    ),
  ).toHaveLength(0);
  expect(f.photoReads()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('n8-first-entry.png'), fullPage: true });

  await guide.getByRole('button', { name: 'Создать первый рецепт' }).click();
  await expect(page.getByRole('tab', { name: 'Содержание' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('Название', { exact: true }).fill('Пирог из семейной тетради');
  await page.getByLabel('Описание').fill('Хрустящая корочка и яблоки с корицей.');
  await page.getByLabel('Подготовка, мин').fill('20');
  await page.getByLabel('Приготовление, мин').fill('40');
  await page.getByText('Выпечка', { exact: true }).click();
  await expect(saved(page)).toBeVisible();

  const contentTab = page.getByRole('tab', { name: 'Содержание' });
  await contentTab.focus();
  await contentTab.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Дизайн' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Дизайн' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Шаблоны страниц' })).toBeVisible();

  await openRecipeMode(page, 'Просмотр');
  await expect(
    page.getByRole('heading', { name: 'Пирог из семейной тетради' }).first(),
  ).toBeVisible();
  await expect(page.locator('.recipe-page-spread')).toHaveAttribute('data-layout-status', 'ready');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
  const card = page
    .locator('.library-recipe-card')
    .filter({ hasText: 'Пирог из семейной тетради' });
  await expect(card.getByText('1 ч')).toBeVisible();
  await expect(card.getByText('Выпечка', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('n8-library.png'), fullPage: true });
});

test('N8 library requests bounded thumbnails without opening private full photos', async ({
  page,
}) => {
  const f = await fixture(page);
  f.addCover();
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Пирог с обложкой');
  await expect(saved(page)).toBeVisible();
  f.clearPhotoReads();
  await page.getByRole('link', { name: 'Библиотека', exact: true }).click();

  const card = page.locator('.library-recipe-card').filter({ hasText: 'Пирог с обложкой' });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('[data-thumbnail-state="ready"]')).toBeVisible();
  expect(f.photoReads().length).toBeGreaterThan(0);
  expect(f.photoReads().every((read) => read.variant === 'thumbnail')).toBe(true);
});

test('opens a historical version for reading without replacing current editor contents', async ({
  page,
}) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Первый рецепт');
  await expect(saved(page)).toBeVisible();
  await page.getByLabel('Название', { exact: true }).fill('Новая версия');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'История');
  const history = page.getByRole('region', { name: 'История рецепта' });
  await history.getByRole('button', { name: 'Показать историю' }).click();
  await history.getByRole('button', { name: /^Версия 1 ·/ }).click();
  await expect(history.getByLabel('Название', { exact: true })).toHaveValue('Первый рецепт');
  await expect(history.getByLabel('Название', { exact: true })).toBeDisabled();
  await openRecipeMode(page, 'Содержание');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Новая версия');
});

test('restores a historical snapshot as a new version and keeps the replaced version', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Первый рецепт');
  await expect(saved(page)).toBeVisible();
  await page.getByLabel('Название', { exact: true }).fill('Новая версия');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'История');
  const history = page.getByRole('region', { name: 'История рецепта' });
  await history.getByRole('button', { name: 'Показать историю' }).click();
  await history.getByRole('button', { name: /^Версия 1 ·/ }).click();
  await history.getByRole('button', { name: 'Восстановить как новую версию' }).click();
  await expect(history).toContainText('Текущая версия останется в истории.');
  const delayedRestore = f.delayNextRestoreResponse();
  await history.getByRole('button', { name: 'Подтвердить восстановление' }).click();
  await delayedRestore.started;
  try {
    await expect(history.getByRole('status')).toHaveCount(0);
    await expect(history.getByLabel('Название', { exact: true })).toHaveValue('Первый рецепт');
    await expect(history.getByLabel('Название', { exact: true })).toBeDisabled();
  } finally {
    delayedRestore.release();
  }
  await expect(history.getByRole('status')).toHaveText('Версия 1 восстановлена как версия 3.');
  await expect(history.getByLabel('Название', { exact: true })).toHaveCount(0);
  await openRecipeMode(page, 'Содержание');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Первый рецепт');
  await expect(saved(page)).toBeVisible();
  expect(f.remote()?.recipe.revision).toBe(3);

  await openRecipeMode(page, 'История');
  await history.getByRole('button', { name: 'Показать историю' }).click();
  await history.getByRole('button', { name: /^Версия 2 ·/ }).click();
  await expect(history.getByLabel('Название', { exact: true })).toHaveValue('Новая версия');
  await expect(history.getByLabel('Название', { exact: true })).toBeDisabled();
});

test('editor saves ingredients and steps, restores after reload, and keeps credentials out of drafts', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Видимость', { exact: true }).selectOption('workspace');
  await page.getByLabel('Название', { exact: true }).fill('Яблочный пирог');
  await page.getByRole('button', { name: 'Добавить ингредиент' }).click();
  await page.getByLabel('Ингредиент 1', { exact: true }).fill('Яблоки');
  await page.getByLabel('Количество ингредиента 1', { exact: true }).fill('4');
  await page.getByLabel('Единица ингредиента 1', { exact: true }).fill('шт.');
  await page.getByRole('button', { name: 'Добавить шаг' }).click();
  await page.getByLabel('Шаг 1', { exact: true }).fill('Нарежьте яблоки и испеките пирог.');
  await page.getByLabel('Личные заметки').fill('Семейный секрет');
  await expect(saved(page)).toBeVisible();
  expect(f.remote()?.ingredients[0]?.name).toBe('Яблоки');
  expect(f.remote()?.steps[0]?.body).toContain('Нарежьте');
  expect(f.remote()?.recipe.visibility).toBe('workspace');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'private-recipe-test-token',
  );
  await page.screenshot({ path: testInfo.outputPath('recipe-editor.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0);
  await login(page);
  await openRecipeMode(page, 'Содержание');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Яблочный пирог');
  await expect(page.getByRole('textbox', { name: 'Шаг 1', exact: true })).toHaveValue(/Нарежьте/);
  await page.getByLabel('Название', { exact: true }).fill('Пирог с корицей');
  await expect(saved(page)).toBeVisible();
  expect(f.remote()?.recipe.title).toBe('Пирог с корицей');
});

test('a lost create receipt survives reload and newer edits without a duplicate recipe', async ({
  page,
}) => {
  const f = await fixture(page);
  f.block(true);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('До перезагрузки');
  await expect(page.getByRole('button', { name: 'Повторить сохранение' })).toBeVisible();
  const path = page.url();
  expect(f.receipts.size).toBe(1);
  await page.reload();
  await login(page);
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('До перезагрузки');
  await page.getByLabel('Название', { exact: true }).fill('После перезагрузки');
  f.block(false);
  await expect(saved(page)).toBeVisible();
  expect(f.remote()?.recipe.title).toBe('После перезагрузки');
  const creates = f.commands.filter((command) => command.action === 'recipes.create');
  expect(new Set(creates.map((command) => command.requestId)).size).toBe(1);
  expect(page.url()).toBe(path);
});

test('shows both conflict versions and keeps the rejected text as a private local copy', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Исходный рецепт');
  await expect(saved(page)).toBeVisible();
  f.changeRemote();
  await page.getByLabel('Название', { exact: true }).fill('Моя новая версия');
  await expect(
    page.getByRole('heading', { name: 'Рецепт изменился в другом месте' }),
  ).toBeVisible();
  await expect(page.getByText('Версия с другого устройства', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('recipe-conflict.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Принять серверную, мою оставить копией' }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue(
    'Версия с другого устройства',
  );
  await page.getByRole('link', { name: 'Открыть копию', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Моя новая версия');
  await expect(page.getByLabel('Видимость', { exact: true })).toHaveValue('private');
});

test('locks the same draft in another tab and unlocks it after the original editor closes', async ({
  page,
  context,
}) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Одна вкладка');
  await expect(saved(page)).toBeVisible();
  const other = await context.newPage();
  await other.goto(page.url());
  await login(other);
  await expect(other.getByRole('alert')).toContainText('другой вкладке');
  await page.getByRole('link', { name: '← В библиотеку' }).click();
  await other.getByRole('button', { name: 'Повторить открытие' }).click();
  await openRecipeMode(other, 'Содержание');
  await expect(other.getByLabel('Название', { exact: true })).toHaveValue('Одна вкладка');
  await other.close();
});

test('hides another account’s drafts and makes shared recipes read-only for viewers', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Личная копия');
  await expect(saved(page)).toBeVisible();
  const draftUrl = page.url();
  f.account('another-sub');
  f.readOnly();
  await page.reload();
  await login(page);
  await expect(page.getByRole('alert')).toContainText('не найден');
  await page.goto(`/#/recipes/${f.recipeId}`);
  await openRecipeMode(page, 'Содержание');
  await expect(page.getByLabel('Название', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить сейчас' })).toHaveCount(0);
  expect(page.url()).not.toBe(draftUrl);
});

test('keeps edits in memory on storage failure, across navigation, and offers a download', async ({
  page,
}) => {
  const f = await fixture(page);
  await create(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('tastory.recipe-draft.'))
        throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByLabel('Название', { exact: true }).fill('Важные правки');
  await expect(page.getByRole('status')).toContainText('Не удалось записать на устройство');
  await page.getByRole('link', { name: '← В библиотеку' }).click();
  await page.getByRole('link', { name: 'Важные правки' }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Важные правки');
  await expect(page.getByRole('status')).toContainText('Не удалось записать на устройство');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать копию' }).click();
  expect((await download).suggestedFilename()).toMatch(/^tastory-draft-.*\.json$/);
  expect(f.receipts.size).toBe(0);
});
