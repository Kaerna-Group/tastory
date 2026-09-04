import { expect, it } from 'vitest';
import type {
  RecipeAggregate,
  RecipeCommand,
  RecipeData,
  RecipeSummary,
  Tag,
} from '@tastory/contracts';
import {
  buildTransferDocument,
  importTransferDocument,
  parseTransferDocument,
  previewTransfer,
  serializeTransferDocument,
  verifyTransferFiles,
} from './recipe-transfer';

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
  const tags = new Map<string, Tag>();
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
  return { request, recipes, counts: () => ({ creates, uploads }) };
}

it('exports and validates a recipe with its original and thumbnail', async () => {
  const source = aggregate(),
    f = fixture([source]);
  const document = await buildTransferDocument('recipe', [source.recipe.id], f.request);
  const text = serializeTransferDocument(document),
    parsed = parseTransferDocument(text);
  await expect(verifyTransferFiles(parsed)).resolves.toBeUndefined();
  expect(parsed.recipes[0]).toMatchObject({
    visibility: 'workspace',
    content: { title: 'Суп с фото' },
    photos: [{ stepSourceId: source.steps[0]?.id, image: { base64: image } }],
  });
  const damaged = structuredClone(parsed);
  if (damaged.recipes[0]?.photos[0]) damaged.recipes[0].photos[0].image.base64 = 'b3RoZXI=';
  await expect(verifyTransferFiles(damaged)).rejects.toThrow('повреждена');
});

it('previews collisions, imports private copies with files and resumes without duplicates', async () => {
  const source = aggregate(),
    exported = await buildTransferDocument('recipe', [source.recipe.id], fixture([source]).request),
    existing = aggregate(source.recipe.title),
    target = fixture([existing]);
  expect(previewTransfer(exported, [summary(existing)]).conflicts).toHaveLength(1);
  await expect(
    importTransferDocument(
      exported,
      { collision: 'skip', visibility: 'private', runId: crypto.randomUUID() },
      target.request,
    ),
  ).resolves.toEqual({ imported: 0, skipped: 1, photos: 0 });
  const runId = crypto.randomUUID();
  await expect(
    importTransferDocument(
      exported,
      { collision: 'copy', visibility: 'private', runId },
      target.request,
    ),
  ).resolves.toEqual({ imported: 1, skipped: 0, photos: 1 });
  expect(target.counts()).toEqual({ creates: 1, uploads: 1 });
  const imported = [...target.recipes.values()].find(
    (item) => item.recipe.id !== existing.recipe.id,
  );
  expect(imported).toMatchObject({
    recipe: { visibility: 'private', title: source.recipe.title },
    photos: [{ kind: 'step' }],
  });
  await importTransferDocument(
    exported,
    { collision: 'copy', visibility: 'private', runId },
    target.request,
  );
  expect(target.counts()).toEqual({ creates: 1, uploads: 1 });
});
