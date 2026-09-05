import { expect, it } from 'vitest';
import type {
  RecipeAggregate,
  RecipeCommand,
  RecipeData,
  RecipeSummary,
  StickerData,
  TemplateData,
  RecipeTemplate,
  RecipeDesign,
  RecipeSticker,
  StickerItem,
  StickerPackView,
  Tag,
} from '@tastory/contracts';
import {
  DEFAULT_RECIPE_THEME,
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
} from '@tastory/contracts';
import {
  buildTransferDocument,
  importTransferDocument,
  parseTransferDocument,
  previewTransfer,
  serializeTransferDocument,
  verifyTransferFiles,
} from './recipe-transfer';
import type { TransferRequests } from './recipe-transfer';

const image = 'aW1hZ2U=',
  thumbnail = 'dGh1bWI=',
  imageDigest = '6fd6529e1a080d633cc56dd862cc9fc4c4a1769a9e2711af7ec81d4abe4be3d7',
  thumbnailDigest = '450c0c354236f2772a51ebcd36fbec081a7bad1705c4fddb2d247e0607cbe9f0';
const digest = (value: string) => (value === image ? imageDigest : thumbnailDigest);
const now = '2026-09-04T00:00:00.000Z';
function aggregate(title = 'Суп с фото'): RecipeAggregate {
  const recipeId = crypto.randomUUID(),
    stepId = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    tagId = crypto.randomUUID();
  return {
    recipe: {
      id: recipeId,
      workspaceId: crypto.randomUUID(),
      ownerUserId: crypto.randomUUID(),
      title,
      description: 'Описание',
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 20,
      sourceUrl: '',
      notes: 'Заметка',
      visibility: 'workspace',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      deletedAt: null,
    },
    ingredients: [
      {
        id: crypto.randomUUID(),
        recipeId,
        sectionTitle: '',
        position: 0,
        name: 'Вода',
        quantityValue: 1,
        quantityText: '',
        unit: 'л',
        note: '',
        isOptional: false,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    steps: [
      {
        id: stepId,
        recipeId,
        sectionTitle: '',
        position: 0,
        body: 'Сварить',
        durationSeconds: null,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    photos: [
      {
        id: photoId,
        recipeId,
        kind: 'step',
        stepId,
        position: 0,
        width: 10,
        height: 10,
        bytes: 5,
        thumbnailBytes: 5,
        imageDigest,
        thumbnailDigest,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    tags: [
      {
        id: tagId,
        workspaceId: crypto.randomUUID(),
        createdBy: crypto.randomUUID(),
        name: 'Обед',
        normalizedName: 'обед',
        colorToken: 'accent',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    recipeTags: [
      {
        recipeId,
        tagId,
        assignedBy: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
  };
}
function summary(value: RecipeAggregate): RecipeSummary {
  return {
    id: value.recipe.id,
    workspaceId: value.recipe.workspaceId,
    ownerUserId: value.recipe.ownerUserId,
    title: value.recipe.title,
    description: value.recipe.description,
    servings: value.recipe.servings,
    prepMinutes: value.recipe.prepMinutes,
    cookMinutes: value.recipe.cookMinutes,
    visibility: value.recipe.visibility,
    status: value.recipe.status,
    ingredientNames: value.ingredients.map((row) => row.name),
    tags: value.tags.map(({ id, name, colorToken }) => ({ id, name, colorToken })),
    coverPhotoId: null,
    favorite: false,
    createdAt: value.recipe.createdAt,
    updatedAt: value.recipe.updatedAt,
    revision: value.recipe.revision,
  };
}
function fixture(initial: RecipeAggregate[] = []) {
  const recipes = new Map(initial.map((item) => [item.recipe.id, structuredClone(item)]));
  const presentations = new Map<string, RecipeTemplate>(
    initial.map((item) => [
      item.recipe.id,
      {
        id: item.recipe.id,
        recipeId: item.recipe.id,
        templateId: crypto.randomUUID(),
        templateName: 'Сохранённая страница',
        category: 'dish',
        layout: 'herbarium',
        theme: {
          ...DEFAULT_RECIPE_THEME,
          name: 'Шалфей',
          palette: { ...DEFAULT_RECIPE_THEME.palette, accent: '#356f4f' },
          paper: 'linen',
        },
        sourceOwnerUserId: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  const tags = new Map<string, Tag>();
  const designs = new Map<string, RecipeDesign>();
  const receipts = new Map<string, RecipeData>();
  let creates = 0,
    uploads = 0;
  const request = async (command: RecipeCommand, requestId: string): Promise<RecipeData> => {
    if (command.action === 'recipes.list')
      return { kind: 'recipes', recipes: [...recipes.values()].map(summary) };
    if (command.action === 'tags.list') return { kind: 'tags', tags: [...tags.values()] };
    if (command.action === 'recipes.get') {
      const value = recipes.get(command.payload.recipeId);
      if (!value) throw new Error('missing');
      return { kind: 'recipe', aggregate: structuredClone(value) };
    }
    if (command.action === 'recipes.photos.read') {
      const value = recipes.get(command.payload.recipeId),
        photo = value?.photos.find((item) => item.id === command.payload.photoId);
      if (!photo) throw new Error('missing');
      return {
        kind: 'photo',
        photo,
        variant: command.payload.variant,
        base64: command.payload.variant === 'image' ? image : thumbnail,
      };
    }
    const replay = receipts.get(requestId);
    if (replay) return replay;
    if (command.action === 'tags.create') {
      const id = crypto.randomUUID();
      tags.set(command.payload.name.toLocaleLowerCase('ru'), {
        id,
        workspaceId: crypto.randomUUID(),
        createdBy: crypto.randomUUID(),
        name: command.payload.name,
        normalizedName: command.payload.name.toLocaleLowerCase('ru'),
        colorToken: command.payload.colorToken,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        revision: 1,
      });
      const result = {
        kind: 'saved' as const,
        operationId: requestId,
        entityId: id,
        entityType: 'tag' as const,
        revision: 1,
        outcome: 'committed' as const,
      };
      receipts.set(requestId, result);
      return result;
    }
    if (command.action === 'recipes.create') {
      creates++;
      const id = crypto.randomUUID(),
        workspaceId = crypto.randomUUID(),
        ownerUserId = crypto.randomUUID(),
        audit = { createdAt: now, updatedAt: now, revision: 1 };
      const value: RecipeAggregate = {
        recipe: {
          ...command.payload.value.content,
          ...audit,
          id,
          workspaceId,
          ownerUserId,
          visibility: command.payload.visibility,
          status: 'draft',
          deletedAt: null,
        },
        ingredients: command.payload.value.ingredients.map((row) => ({
          ...row,
          ...audit,
          id: crypto.randomUUID(),
          recipeId: id,
        })),
        steps: command.payload.value.steps.map((row) => ({
          ...row,
          ...audit,
          id: crypto.randomUUID(),
          recipeId: id,
        })),
        photos: [],
        tags: command.payload.value.tagIds.map((tagId) => {
          const tag = [...tags.values()].find((item) => item.id === tagId);
          if (!tag) throw new Error('tag');
          return tag;
        }),
        recipeTags: command.payload.value.tagIds.map((tagId) => ({
          recipeId: id,
          tagId,
          assignedBy: ownerUserId,
          ...audit,
        })),
      };
      recipes.set(id, value);
      const result = {
        kind: 'saved' as const,
        operationId: requestId,
        entityId: id,
        entityType: 'recipe' as const,
        revision: 1,
        outcome: 'committed' as const,
      };
      receipts.set(requestId, result);
      return result;
    }
    if (command.action === 'recipes.photos.add') {
      uploads++;
      const value = recipes.get(command.payload.recipeId);
      if (!value) throw new Error('missing');
      value.recipe.revision++;
      value.photos.push({
        id: requestId,
        recipeId: value.recipe.id,
        kind: command.payload.target.kind,
        stepId: command.payload.target.kind === 'step' ? command.payload.target.stepId : null,
        position: command.payload.target.position,
        width: command.payload.photo.width,
        height: command.payload.photo.height,
        bytes: command.payload.photo.imageBytes,
        thumbnailBytes: command.payload.photo.thumbnailBytes,
        imageDigest: digest(command.payload.photo.imageBase64),
        thumbnailDigest: digest(command.payload.photo.thumbnailBase64),
        createdAt: now,
        updatedAt: now,
        revision: 1,
      });
      const result = {
        kind: 'saved' as const,
        operationId: requestId,
        entityId: value.recipe.id,
        entityType: 'recipe' as const,
        revision: value.recipe.revision,
        outcome: 'committed' as const,
      };
      receipts.set(requestId, result);
      return result;
    }
    throw new Error(`unexpected ${command.action}`);
  };
  const templateReceipts = new Map<string, TemplateData>();
  const templates = async (
    command: Parameters<TransferRequests['templates']>[0],
    requestId: string,
  ): Promise<TemplateData> => {
    if (command.action === 'recipes.template.get')
      return {
        kind: 'recipeTemplate',
        recipeId: command.payload.recipeId,
        template: presentations.get(command.payload.recipeId) ?? null,
        outcome: 'read',
      };
    if (command.action === 'recipes.design.get')
      return {
        kind: 'recipeDesign',
        recipeId: command.payload.recipeId,
        design: designs.get(command.payload.recipeId) ?? null,
        outcome: 'read',
      };
    if (command.action === 'recipes.template.restore') {
      const replay = templateReceipts.get(requestId);
      if (replay) return replay;
      const previous = presentations.get(command.payload.recipeId);
      const restored: RecipeTemplate = {
        id: command.payload.recipeId,
        recipeId: command.payload.recipeId,
        templateId: null,
        ...command.payload.snapshot,
        sourceOwnerUserId: null,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      presentations.set(command.payload.recipeId, restored);
      if (command.payload.design) {
        const previousDesign = designs.get(command.payload.recipeId);
        designs.set(command.payload.recipeId, {
          id: command.payload.recipeId,
          recipeId: command.payload.recipeId,
          revision: (previousDesign?.revision ?? 0) + 1,
          recipeTemplateRevision: restored.revision,
          sourceTemplateId: null,
          sourceTemplateRevision: null,
          value: command.payload.design,
          createdAt: previousDesign?.createdAt ?? now,
          updatedAt: now,
        });
      }
      const result: TemplateData = {
        kind: 'recipeTemplate',
        recipeId: command.payload.recipeId,
        template: restored,
        outcome: 'committed',
      };
      templateReceipts.set(requestId, result);
      return result;
    }
    if (command.action === 'recipes.design.save') {
      const replay = templateReceipts.get(requestId);
      if (replay) return replay;
      const previous = designs.get(command.payload.recipeId);
      const design: RecipeDesign = {
        id: command.payload.recipeId,
        recipeId: command.payload.recipeId,
        revision: (previous?.revision ?? 0) + 1,
        recipeTemplateRevision: presentations.get(command.payload.recipeId)?.revision ?? null,
        sourceTemplateId: null,
        sourceTemplateRevision: null,
        value: command.payload.value,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      designs.set(command.payload.recipeId, design);
      const result: TemplateData = {
        kind: 'recipeDesign',
        recipeId: command.payload.recipeId,
        design,
        outcome: 'committed',
      };
      templateReceipts.set(requestId, result);
      return result;
    }
    throw new Error(`unexpected ${command.action}`);
  };
  const stickers = async (
    command: Parameters<TransferRequests['stickers']>[0],
  ): Promise<StickerData> => {
    if (command.action === 'recipes.stickers.list')
      return { kind: 'recipeStickers', recipeId: command.payload.recipeId, stickers: [] };
    if (command.action === 'stickers.packs.list') return { kind: 'stickerPacks', packs: [] };
    throw new Error(`unexpected ${command.action}`);
  };
  return {
    request,
    requests: { recipes: request, templates, stickers },
    recipes,
    presentations,
    designs,
    counts: () => ({ creates, uploads }),
  };
}

function sourceStickerRequests(base: TransferRequests, recipeId: string) {
  const packId = crypto.randomUUID();
  const stickerId = crypto.randomUUID();
  const placement: RecipeSticker = {
    id: crypto.randomUUID(),
    recipeId,
    stickerId,
    packId,
    name: 'Лимонная ветка',
    emoji: '🍋',
    mimeType: 'image/png',
    assetWidth: 10,
    assetHeight: 12,
    assetBytes: 5,
    assetDigest: imageDigest,
    assetKey: null,
    page: 2,
    x: 17,
    y: 23,
    width: 18,
    height: 20,
    rotation: -7,
    zIndex: 4,
    status: 'active',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...base,
    stickers: async (
      command: Parameters<TransferRequests['stickers']>[0],
      requestId: string,
      signal?: AbortSignal,
    ): Promise<StickerData> => {
      if (command.action === 'recipes.stickers.list')
        return { kind: 'recipeStickers', recipeId, stickers: [placement] };
      if (command.action === 'stickers.assets.read')
        return { kind: 'stickerAsset', mimeType: 'image/png', base64: image, digest: imageDigest };
      return base.stickers(command, requestId, signal);
    },
  } satisfies TransferRequests;
}

function targetStickerRequests(base: TransferRequests) {
  const packs = new Map<string, StickerPackView>();
  const placements = new Map<string, RecipeSticker>();
  const stickers = async (
    command: Parameters<TransferRequests['stickers']>[0],
    requestId: string,
  ): Promise<StickerData> => {
    if (command.action === 'stickers.packs.list')
      return { kind: 'stickerPacks', packs: [...packs.values()] };
    if (command.action === 'stickers.packs.create') {
      const view: StickerPackView = {
        pack: {
          id: requestId,
          workspaceId: crypto.randomUUID(),
          ownerUserId: crypto.randomUUID(),
          kind: 'custom',
          ...command.payload,
          status: 'active',
          position: packs.size,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        stickers: [],
        canManage: true,
      };
      packs.set(requestId, view);
      return { kind: 'stickerPack', ...view, outcome: 'committed' };
    }
    if (command.action === 'stickers.items.add') {
      const view = packs.get(command.payload.packId);
      if (!view) throw new Error('missing pack');
      const item: StickerItem = {
        id: requestId,
        packId: view.pack.id,
        name: command.payload.name,
        normalizedName: command.payload.name.toLocaleLowerCase('ru'),
        emoji: command.payload.emoji,
        position: command.payload.position,
        mimeType: command.payload.upload.mimeType,
        width: command.payload.upload.width,
        height: command.payload.upload.height,
        bytes: command.payload.upload.bytes,
        digest: imageDigest,
        assetKey: null,
        status: 'active',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      const next: StickerPackView = {
        ...view,
        pack: { ...view.pack, revision: view.pack.revision + 1 },
        stickers: [...view.stickers, item],
      };
      packs.set(view.pack.id, next);
      return { kind: 'stickerPack', ...next, outcome: 'committed' };
    }
    if (command.action === 'recipes.stickers.list')
      return {
        kind: 'recipeStickers',
        recipeId: command.payload.recipeId,
        stickers: [...placements.values()].filter(
          (placement) => placement.recipeId === command.payload.recipeId,
        ),
      };
    if (command.action === 'recipes.stickers.add') {
      const item = [...packs.values()]
        .flatMap((view) => view.stickers)
        .find((candidate) => candidate.id === command.payload.stickerId);
      if (!item) throw new Error('missing sticker');
      const placement: RecipeSticker = {
        id: requestId,
        recipeId: command.payload.recipeId,
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
      placements.set(requestId, placement);
      return {
        kind: 'recipeSticker',
        recipeId: command.payload.recipeId,
        sticker: placement,
        outcome: 'committed',
      };
    }
    throw new Error(`unexpected ${command.action}`);
  };
  return { requests: { ...base, stickers } satisfies TransferRequests, packs, placements };
}

it('exports and validates a recipe with its original and thumbnail', async () => {
  const source = aggregate(),
    f = fixture([source]);
  const document = await buildTransferDocument('recipe', [source.recipe.id], f.requests);
  const text = serializeTransferDocument(document),
    parsed = parseTransferDocument(text);
  await expect(verifyTransferFiles(parsed)).resolves.toBeUndefined();
  expect(parsed.recipes[0]).toMatchObject({
    visibility: 'workspace',
    content: { title: 'Суп с фото' },
    photos: [{ stepSourceId: source.steps[0]?.id, image: { base64: image } }],
    presentation: { layout: 'herbarium', theme: { paper: 'linen' } },
  });
  const damaged = structuredClone(parsed);
  if (damaged.recipes[0]?.photos[0]) damaged.recipes[0].photos[0].image.base64 = 'b3RoZXI=';
  await expect(verifyTransferFiles(damaged)).rejects.toThrow('повреждена');
});

it('previews collisions, imports private copies with files and resumes without duplicates', async () => {
  const source = aggregate(),
    sourceFixture = fixture([source]),
    sourceElementId = crypto.randomUUID();
  sourceFixture.designs.set(source.recipe.id, {
    id: source.recipe.id,
    recipeId: source.recipe.id,
    revision: 1,
    recipeTemplateRevision: 1,
    sourceTemplateId: null,
    sourceTemplateRevision: null,
    value: {
      version: RECIPE_DESIGN_VERSION,
      layout: 'herbarium',
      layoutVersion: RECIPE_LAYOUT_VERSION,
      layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
      theme: { ...DEFAULT_RECIPE_THEME, name: 'Шалфей', paper: 'linen' },
      elements: [
        {
          id: sourceElementId,
          binding: 'notes',
          region: 'body',
          x: 10,
          y: 70,
          width: 80,
          height: 15,
          rotation: 0,
          zIndex: 2,
          locked: true,
        },
      ],
    },
    createdAt: now,
    updatedAt: now,
  });
  const exported = await buildTransferDocument(
      'recipe',
      [source.recipe.id],
      sourceFixture.requests,
    ),
    existing = aggregate(source.recipe.title),
    target = fixture([existing]);
  expect(previewTransfer(exported, [summary(existing)]).conflicts).toHaveLength(1);
  await expect(
    importTransferDocument(
      exported,
      { collision: 'skip', visibility: 'private', runId: crypto.randomUUID() },
      target.requests,
    ),
  ).resolves.toEqual({ imported: 0, skipped: 1, photos: 0, stickers: 0 });
  const runId = crypto.randomUUID();
  await expect(
    importTransferDocument(
      exported,
      { collision: 'copy', visibility: 'private', runId },
      target.requests,
    ),
  ).resolves.toEqual({ imported: 1, skipped: 0, photos: 1, stickers: 0 });
  expect(target.counts()).toEqual({ creates: 1, uploads: 1 });
  const imported = [...target.recipes.values()].find(
    (item) => item.recipe.id !== existing.recipe.id,
  );
  expect(imported).toMatchObject({
    recipe: { visibility: 'private', title: source.recipe.title },
    photos: [{ kind: 'step' }],
  });
  expect(target.presentations.get(imported?.recipe.id ?? '')).toMatchObject({
    templateId: null,
    layout: 'herbarium',
    theme: { name: 'Шалфей', paper: 'linen' },
  });
  const importedDesign = target.designs.get(imported?.recipe.id ?? '');
  expect(importedDesign).toMatchObject({
    revision: 1,
    value: { layout: 'herbarium', elements: [{ x: 10, y: 70 }] },
  });
  expect(importedDesign?.value.elements[0]?.id).not.toBe(sourceElementId);
  await importTransferDocument(
    exported,
    { collision: 'copy', visibility: 'private', runId },
    target.requests,
  );
  expect(target.counts()).toEqual({ creates: 1, uploads: 1 });
});

it('moves custom sticker assets and placements through the versioned file without duplicates', async () => {
  const source = aggregate('Пирог со стикером');
  const sourceFixture = fixture([source]);
  const exported = await buildTransferDocument(
    'recipe',
    [source.recipe.id],
    sourceStickerRequests(sourceFixture.requests, source.recipe.id),
  );
  expect(exported).toMatchObject({
    version: 3,
    recipes: [
      {
        stickers: [
          {
            name: 'Лимонная ветка',
            asset: { base64: image, digest: imageDigest },
            page: 2,
            rotation: -7,
          },
        ],
      },
    ],
  });

  const target = fixture();
  const visualTarget = targetStickerRequests(target.requests);
  const options = {
    collision: 'copy' as const,
    visibility: 'private' as const,
    runId: crypto.randomUUID(),
  };
  await expect(
    importTransferDocument(exported, options, visualTarget.requests),
  ).resolves.toMatchObject({
    imported: 1,
    stickers: 1,
  });
  await expect(
    importTransferDocument(exported, options, visualTarget.requests),
  ).resolves.toMatchObject({
    stickers: 0,
  });
  expect(visualTarget.packs).toHaveLength(1);
  expect(visualTarget.placements).toHaveLength(1);
  expect([...visualTarget.placements.values()][0]).toMatchObject({
    page: 2,
    x: 17,
    y: 23,
    rotation: -7,
  });
});
