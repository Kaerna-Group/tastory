import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  BUILTIN_RECIPE_TEMPLATES,
  BUILTIN_STICKER_PACKS,
  recipeCommandSchema,
  recipeSummarySchema,
  stickerCommandSchema,
  templateCommandSchema,
} from '@tastory/contracts';
import type {
  RecipeAggregate,
  RecipeData,
  RecipeSticker,
  RecipeTemplate,
  RecipeTemplateRecord,
} from '@tastory/contracts';

const provider = `window.google = { accounts: { id: {
  initialize(options) { this.callback = options.callback; },
  renderButton(element) { const button = document.createElement('button'); button.textContent = 'Google (тест)'; button.onclick = () => this.callback({ credential: 'private-recipe-test-token' }); element.append(button); },
  disableAutoSelect() {}
} } };`;
async function fixture(page: Page) {
  let remote: RecipeAggregate | null = null;
  let blocked = false;
  let readonly = false;
  let recipeReady = true;
  let subject = 'chef-sub';
  const favoriteUsers = new Set<string>();
  const receipts = new Map<string, RecipeData>();
  const versions = new Map<number, RecipeAggregate>();
  let stickerPlacements: RecipeSticker[] = [];
  let appliedTemplate: RecipeTemplate | null = null;
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
        } else throw new Error(`Unexpected sticker fixture action: ${command.action}`);
      } else if (
        request.action.startsWith('templates.') ||
        request.action.startsWith('recipes.template.')
      ) {
        const command = templateCommandSchema.parse({
          action: request.action,
          payload: request.payload,
        });
        commands.push({ action: command.action, requestId: request.requestId });
        const allTemplates = [...BUILTIN_RECIPE_TEMPLATES, ...customTemplates];
        if (command.action === 'templates.list') {
          const needle = command.payload.query.trim().toLocaleLowerCase('ru');
          data = {
            kind: 'templateLibrary',
            templates: allTemplates
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
                  `${template.name} ${template.description}`
                    .toLocaleLowerCase('ru')
                    .includes(needle),
              )
              .map((template) => ({
                template,
                authorName: template.kind === 'builtin' ? 'Tastory' : 'Повар Анна',
                canManage:
                  !readonly && template.kind === 'custom' && template.ownerUserId === ownerUserId,
                canCopy:
                  !readonly &&
                  (template.kind === 'builtin' || template.ownerUserId !== ownerUserId),
              })),
          };
        } else if (command.action === 'recipes.template.get') {
          data = {
            kind: 'recipeTemplate',
            recipeId: command.payload.recipeId,
            template: appliedTemplate,
            outcome: 'read',
          };
        } else if (command.action === 'recipes.template.apply') {
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
            sourceOwnerUserId: source.ownerUserId,
            revision: (appliedTemplate?.revision ?? 0) + 1,
            createdAt: appliedTemplate?.createdAt ?? now,
            updatedAt: now,
          };
          data = {
            kind: 'recipeTemplate',
            recipeId: command.payload.recipeId,
            template: appliedTemplate,
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
          data = { kind: 'initialized', schemaVersion: 8, alreadyApplied: false };
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
        } else if (command.action === 'tags.list') data = { kind: 'tags', tags: [] };
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
        else if (command.action === 'recipes.version')
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
              photos: remote?.photos ?? [],
              tags: [],
              recipeTags: [],
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
    receipts,
    recipeId,
    remote: () => remote,
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

test('owner automatically applies the current recipe schema once', async ({ page }) => {
  const f = await fixture(page);
  f.requireRecipeInitialization();
  await page.goto('/');
  await login(page);
  await expect(page.getByRole('heading', { name: 'Рецепты в тетради' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
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
});

test('uses ten recipe templates and copies a shared style into the personal library', async ({
  page,
}) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Лимонный тарт');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Дизайн');

  const library = page.getByRole('region', { name: 'Шаблоны страниц' });
  await expect(library.locator('.template-card')).toHaveCount(11);
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

test('opens a saved recipe as a book page and keeps editing in a separate mode', async ({
  page,
}, testInfo) => {
  await fixture(page);
  await create(page);
  await page.getByLabel('Название', { exact: true }).fill('Семейный пирог');
  await page.getByLabel('Описание').fill('Тёплый рецепт для воскресного обеда.');
  await page.getByRole('button', { name: 'Добавить ингредиент' }).click();
  await page.getByLabel('Ингредиент 1', { exact: true }).fill('Яблоки');
  await page.getByRole('button', { name: 'Добавить шаг' }).click();
  await page.getByLabel('Шаг 1', { exact: true }).fill('Нарежьте яблоки и испеките пирог.');
  await expect(saved(page)).toBeVisible();
  await openRecipeMode(page, 'Просмотр');

  const sheet = page.getByRole('article', { name: /Страница 1: Семейный пирог/ });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-layout', 'hearth');
  await expect(sheet).toContainText('Яблоки');
  await expect(sheet).toContainText('Нарежьте яблоки');
  await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('recipe-book-view.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.reload();
  await login(page);
  await expect(page.getByRole('tab', { name: 'Просмотр', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('article', { name: /Страница 1: Семейный пирог/ })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect
    .poll(() =>
      page.locator('.app-header').evaluate((element) => getComputedStyle(element).display),
    )
    .toBe('none');
  await page.emulateMedia({ media: 'screen' });
  await openRecipeMode(page, 'Содержание');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Семейный пирог');
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
  await expect(library.getByRole('link', { name: 'Яблочный пирог' })).toBeVisible();
  await library.getByRole('button', { name: 'Список' }).click();
  await expect(page).toHaveURL(/view=list/);
  await library.getByRole('button', { name: 'Добавить в избранное' }).click();
  await library.getByText('Только избранное').click();
  await expect(page).toHaveURL(/favorite=1/);
  await page.reload();
  await login(page);
  await expect(library.getByRole('link', { name: 'Яблочный пирог' })).toBeVisible();
  await expect(library.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
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
  await history.getByRole('button', { name: 'Подтвердить восстановление' }).click();
  await expect(page.getByLabel('Название', { exact: true }).first()).toHaveValue('Первый рецепт');
  await expect(saved(page)).toBeVisible();
  expect(f.remote()?.recipe.revision).toBe(3);
  await history.getByRole('button', { name: 'Показать историю' }).click();
  await history.getByRole('button', { name: /^Версия 2 ·/ }).click();
  await expect(history.getByLabel('Название', { exact: true })).toHaveValue('Новая версия');
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
