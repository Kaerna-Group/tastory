import {
  RECIPE_TRANSFER_FILE_LIMIT,
  normalizeTagName,
  recipeTransferDocumentSchema,
} from '@tastory/contracts';
import type {
  RecipeAggregate,
  RecipeCommand,
  RecipeData,
  RecipeSummary,
  RecipeTransferDocument,
  RecipeTransferRecipe,
  Tag,
} from '@tastory/contracts';

export type TransferRequest = (
  command: RecipeCommand,
  requestId: string,
  signal?: AbortSignal,
) => Promise<RecipeData>;
export type TransferProgress = Readonly<{ completed: number; total: number; message: string }>;
export type TransferPreview = Readonly<{
  recipes: number;
  photos: number;
  ingredients: number;
  steps: number;
  conflicts: { sourceId: string; title: string; existingIds: string[] }[];
}>;
export type ImportOptions = Readonly<{
  collision: 'copy' | 'skip';
  visibility: 'private' | 'preserve';
  runId: string;
}>;
export type ImportReport = Readonly<{
  imported: number;
  skipped: number;
  photos: number;
}>;

const byteLength = (base64: string) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
};
async function sha256(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function requestId(runId: string, key: string) {
  const hash = await sha256(`${runId}\u0000${key}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function recipeValue(recipe: RecipeTransferRecipe, tagIds: string[]) {
  return {
    content: recipe.content,
    ingredients: recipe.ingredients.map(({ sourceId, ...row }) => {
      void sourceId;
      return row;
    }),
    steps: recipe.steps.map(({ sourceId, ...row }) => {
      void sourceId;
      return row;
    }),
    tagIds,
  };
}
function portableRecipe(
  aggregate: RecipeAggregate,
  photos: RecipeTransferRecipe['photos'],
): RecipeTransferRecipe {
  return {
    sourceId: aggregate.recipe.id,
    sourceRevision: aggregate.recipe.revision,
    visibility: aggregate.recipe.visibility,
    status: aggregate.recipe.status,
    content: {
      title: aggregate.recipe.title,
      description: aggregate.recipe.description,
      servings: aggregate.recipe.servings,
      prepMinutes: aggregate.recipe.prepMinutes,
      cookMinutes: aggregate.recipe.cookMinutes,
      sourceUrl: aggregate.recipe.sourceUrl,
      notes: aggregate.recipe.notes,
    },
    ingredients: aggregate.ingredients.map(
      ({ id: sourceId, recipeId, createdAt, updatedAt, revision, ...row }) => {
        void recipeId;
        void createdAt;
        void updatedAt;
        void revision;
        return { sourceId, ...row };
      },
    ),
    steps: aggregate.steps.map(
      ({ id: sourceId, recipeId, createdAt, updatedAt, revision, ...row }) => {
        void recipeId;
        void createdAt;
        void updatedAt;
        void revision;
        return { sourceId, ...row };
      },
    ),
    tags: aggregate.tags.map(({ id: sourceId, name, colorToken }) => ({
      sourceId,
      name,
      colorToken,
    })),
    photos,
  };
}

export async function buildTransferDocument(
  kind: 'recipe' | 'book',
  recipeIds: string[],
  request: TransferRequest,
  signal?: AbortSignal,
  progress?: (value: TransferProgress) => void,
): Promise<RecipeTransferDocument> {
  if (!recipeIds.length || (kind === 'recipe' && recipeIds.length !== 1))
    throw new Error('Для экспорта не выбраны рецепты.');
  const recipes: RecipeTransferRecipe[] = [];
  let completed = 0;
  for (const recipeId of recipeIds) {
    signal?.throwIfAborted();
    const result = await request(
      { action: 'recipes.get', payload: { recipeId } },
      crypto.randomUUID(),
      signal,
    );
    if (result.kind !== 'recipe') throw new Error('Не удалось прочитать рецепт для экспорта.');
    const photos: RecipeTransferRecipe['photos'] = [];
    for (const photo of result.aggregate.photos) {
      signal?.throwIfAborted();
      const [image, thumbnail] = await Promise.all([
        request(
          {
            action: 'recipes.photos.read',
            payload: { recipeId, photoId: photo.id, variant: 'image' },
          },
          crypto.randomUUID(),
          signal,
        ),
        request(
          {
            action: 'recipes.photos.read',
            payload: { recipeId, photoId: photo.id, variant: 'thumbnail' },
          },
          crypto.randomUUID(),
          signal,
        ),
      ]);
      if (image.kind !== 'photo' || thumbnail.kind !== 'photo')
        throw new Error('Не удалось прочитать фотографию рецепта.');
      photos.push({
        sourceId: photo.id,
        kind: photo.kind,
        stepSourceId: photo.stepId,
        position: photo.position,
        width: photo.width,
        height: photo.height,
        image: { bytes: photo.bytes, digest: photo.imageDigest, base64: image.base64 },
        thumbnail: {
          bytes: photo.thumbnailBytes,
          digest: photo.thumbnailDigest,
          base64: thumbnail.base64,
        },
      });
    }
    recipes.push(portableRecipe(result.aggregate, photos));
    completed++;
    progress?.({ completed, total: recipeIds.length, message: result.aggregate.recipe.title });
  }
  const document = recipeTransferDocumentSchema.parse({
    format: 'tastory.recipe-book',
    version: 1,
    kind,
    exportedAt: new Date().toISOString(),
    recipes,
  });
  await verifyTransferFiles(document, signal);
  return document;
}

export function serializeTransferDocument(document: RecipeTransferDocument) {
  const parsed = recipeTransferDocumentSchema.parse(document);
  const text = JSON.stringify(parsed);
  if (new TextEncoder().encode(text).byteLength > RECIPE_TRANSFER_FILE_LIMIT)
    throw new Error('Файл переноса превышает 250 МБ. Разделите книгу на несколько файлов.');
  return text;
}

export function parseTransferDocument(text: string) {
  if (new TextEncoder().encode(text).byteLength > RECIPE_TRANSFER_FILE_LIMIT)
    throw new Error('Файл переноса превышает 250 МБ.');
  try {
    return recipeTransferDocumentSchema.parse(JSON.parse(text));
  } catch {
    throw new Error('Это повреждённый или несовместимый файл Tastory.');
  }
}

export async function transferFingerprint(text: string) {
  return sha256(text);
}

export async function verifyTransferFiles(document: RecipeTransferDocument, signal?: AbortSignal) {
  for (const recipe of document.recipes)
    for (const photo of recipe.photos)
      for (const file of [photo.image, photo.thumbnail]) {
        signal?.throwIfAborted();
        if (byteLength(file.base64) !== file.bytes || (await sha256(file.base64)) !== file.digest)
          throw new Error(`Фотография в рецепте «${recipe.content.title}» повреждена.`);
      }
}

const normalizedTitle = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
export function previewTransfer(
  document: RecipeTransferDocument,
  existing: RecipeSummary[],
): TransferPreview {
  const titles = new Map<string, string[]>();
  const fileTitles = new Map<string, number>();
  for (const recipe of existing) {
    const key = normalizedTitle(recipe.title);
    titles.set(key, [...(titles.get(key) ?? []), recipe.id]);
  }
  for (const recipe of document.recipes) {
    const key = normalizedTitle(recipe.content.title);
    fileTitles.set(key, (fileTitles.get(key) ?? 0) + 1);
  }
  return {
    recipes: document.recipes.length,
    photos: document.recipes.reduce((sum, recipe) => sum + recipe.photos.length, 0),
    ingredients: document.recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0),
    steps: document.recipes.reduce((sum, recipe) => sum + recipe.steps.length, 0),
    conflicts: document.recipes.flatMap((recipe) => {
      const title = normalizedTitle(recipe.content.title);
      const existingIds = titles.get(title) ?? [];
      return existingIds.length || (fileTitles.get(title) ?? 0) > 1
        ? [{ sourceId: recipe.sourceId, title: recipe.content.title, existingIds }]
        : [];
    }),
  };
}

async function listTags(request: TransferRequest, signal?: AbortSignal) {
  const result = await request({ action: 'tags.list', payload: {} }, crypto.randomUUID(), signal);
  if (result.kind !== 'tags') throw new Error('Не удалось прочитать теги.');
  return result.tags;
}
async function ensureTags(
  recipe: RecipeTransferRecipe,
  runId: string,
  request: TransferRequest,
  known: Map<string, Tag>,
  signal?: AbortSignal,
) {
  const tagIds: string[] = [];
  for (const source of recipe.tags) {
    const normalized = normalizeTagName(source.name);
    let tag = known.get(normalized);
    if (!tag) {
      try {
        const receipt = await request(
          { action: 'tags.create', payload: { name: source.name, colorToken: source.colorToken } },
          await requestId(runId, `tag:${normalized}`),
          signal,
        );
        if (receipt.kind !== 'saved') throw new Error('Не удалось создать тег.');
        const refreshed = await listTags(request, signal);
        for (const item of refreshed) known.set(item.normalizedName, item);
        tag = known.get(normalized);
      } catch (error) {
        const refreshed = await listTags(request, signal);
        for (const item of refreshed) known.set(item.normalizedName, item);
        tag = known.get(normalized);
        if (!tag) throw error;
      }
    }
    if (!tag) throw new Error(`Не удалось подготовить тег «${source.name}».`);
    tagIds.push(tag.id);
  }
  return tagIds;
}
async function getRecipe(recipeId: string, request: TransferRequest, signal?: AbortSignal) {
  const result = await request(
    { action: 'recipes.get', payload: { recipeId } },
    crypto.randomUUID(),
    signal,
  );
  if (result.kind !== 'recipe') throw new Error('Не удалось загрузить импортированный рецепт.');
  return result.aggregate;
}

export async function importTransferDocument(
  document: RecipeTransferDocument,
  options: ImportOptions,
  request: TransferRequest,
  signal?: AbortSignal,
  progress?: (value: TransferProgress) => void,
): Promise<ImportReport> {
  recipeTransferDocumentSchema.parse(document);
  await verifyTransferFiles(document, signal);
  const listed = await request(
    { action: 'recipes.list', payload: {} },
    crypto.randomUUID(),
    signal,
  );
  if (listed.kind !== 'recipes') throw new Error('Не удалось проверить совпадения рецептов.');
  const existingTitles = new Set(listed.recipes.map((recipe) => normalizedTitle(recipe.title)));
  const knownTags = new Map(
    (await listTags(request, signal)).map((tag) => [tag.normalizedName, tag]),
  );
  let imported = 0,
    skipped = 0,
    importedPhotos = 0,
    completed = 0;
  for (const source of document.recipes) {
    signal?.throwIfAborted();
    if (options.collision === 'skip' && existingTitles.has(normalizedTitle(source.content.title))) {
      skipped++;
      completed++;
      progress?.({ completed, total: document.recipes.length, message: source.content.title });
      continue;
    }
    const tagIds = await ensureTags(source, options.runId, request, knownTags, signal);
    const createId = await requestId(options.runId, `recipe:${source.sourceId}`);
    const receipt = await request(
      {
        action: 'recipes.create',
        payload: {
          visibility: options.visibility === 'preserve' ? source.visibility : 'private',
          value: recipeValue(source, tagIds),
        },
      },
      createId,
      signal,
    );
    if (receipt.kind !== 'saved' || receipt.outcome === 'cancelled')
      throw new Error(`Не удалось импортировать рецепт «${source.content.title}».`);
    let current = await getRecipe(receipt.entityId, request, signal);
    const targetSteps = new Map(
      source.steps.map((step) => [
        step.sourceId,
        current.steps.find((candidate) => candidate.position === step.position)?.id,
      ]),
    );
    const photos = [...source.photos].sort((a, b) => {
      const order = { cover: 0, gallery: 1, step: 2 } as const;
      return order[a.kind] - order[b.kind] || a.position - b.position;
    });
    for (const photo of photos) {
      const uploadId = await requestId(options.runId, `photo:${source.sourceId}:${photo.sourceId}`);
      if (current.photos.some((item) => item.id === uploadId)) continue;
      let target:
        | { kind: 'cover'; position: 0 }
        | { kind: 'gallery'; position: number }
        | { kind: 'step'; stepId: string; position: number };
      if (photo.kind === 'step') {
        const stepId = targetSteps.get(photo.stepSourceId ?? '');
        if (!stepId)
          throw new Error(`Не найден шаг для фотографии в рецепте «${source.content.title}».`);
        target = { kind: 'step', stepId, position: photo.position };
      } else if (photo.kind === 'cover') target = { kind: 'cover', position: 0 };
      else target = { kind: 'gallery', position: photo.position };
      const photoReceipt = await request(
        {
          action: 'recipes.photos.add',
          payload: {
            recipeId: current.recipe.id,
            expectedRevision: current.recipe.revision,
            photo: {
              uploadId,
              imageBase64: photo.image.base64,
              thumbnailBase64: photo.thumbnail.base64,
              width: photo.width,
              height: photo.height,
              imageBytes: photo.image.bytes,
              thumbnailBytes: photo.thumbnail.bytes,
            },
            target,
          },
        },
        uploadId,
        signal,
      );
      if (photoReceipt.kind !== 'saved' || photoReceipt.outcome === 'cancelled')
        throw new Error(`Не удалось импортировать фотографию рецепта «${source.content.title}».`);
      current = await getRecipe(current.recipe.id, request, signal);
      importedPhotos++;
    }
    imported++;
    existingTitles.add(normalizedTitle(source.content.title));
    completed++;
    progress?.({ completed, total: document.recipes.length, message: source.content.title });
  }
  return { imported, skipped, photos: importedPhotos };
}
