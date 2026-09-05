import { z } from 'zod';
import {
  RECIPE_LIMITS,
  normalizeTagName,
  recipeContentSchema,
  recipePhotoKindSchema,
  recipeStatusSchema,
  recipeVisibilitySchema,
} from './recipe';
import { PHOTO_LIMITS } from './photo';
import { STICKER_LIMITS, stickerBuiltinAssetSchema, stickerMimeSchema } from './sticker';
import { recipeTemplateSnapshotSchema } from './template';
import {
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
  recipeDesignValueSchema,
} from './recipe-design';
import { DEFAULT_RECIPE_THEME } from './template';

export const RECIPE_TRANSFER_FORMAT = 'tastory.recipe-book' as const;
export const RECIPE_TRANSFER_VERSION = 3 as const;
export const RECIPE_TRANSFER_FILE_LIMIT = 250 * 1024 * 1024;

const id = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = (bytes: number) =>
  z
    .string()
    .min(4)
    .max(Math.ceil(bytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((value) => value.length % 4 === 0);
const orderedFields = {
  sectionTitle: z.string().trim().max(200),
  position: z.number().int().min(0).max(10000),
};

export const recipeTransferFileSchema = z.strictObject({
  bytes: z.number().int().positive().max(PHOTO_LIMITS.imageBytes),
  digest,
  base64: base64(PHOTO_LIMITS.imageBytes),
});
const thumbnailFileSchema = recipeTransferFileSchema.extend({
  bytes: z.number().int().positive().max(PHOTO_LIMITS.thumbnailBytes),
  base64: base64(PHOTO_LIMITS.thumbnailBytes),
});
const stickerFileSchema = z.strictObject({
  bytes: z.number().int().positive().max(STICKER_LIMITS.imageBytes),
  digest,
  base64: base64(STICKER_LIMITS.imageBytes),
});
export const recipeTransferStickerSchema = z
  .strictObject({
    sourceId: id,
    sourceStickerId: id,
    sourcePackId: id,
    name: z.string().trim().min(1).max(STICKER_LIMITS.name),
    emoji: z.string().trim().max(16),
    mimeType: stickerMimeSchema,
    assetWidth: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
    assetHeight: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
    assetBytes: z.number().int().positive().max(STICKER_LIMITS.imageBytes),
    assetDigest: digest,
    assetKey: stickerBuiltinAssetSchema.nullable(),
    asset: stickerFileSchema.nullable(),
    page: z.number().int().min(1).max(100),
    pageId: z
      .string()
      .regex(/^page-([1-9][0-9]?|100)$/)
      .optional(),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().min(2).max(100),
    height: z.number().min(2).max(100),
    rotation: z.number().min(-180).max(180),
    zIndex: z.number().int().min(0).max(10000),
  })
  .superRefine((value, ctx) => {
    if (value.pageId !== undefined && value.pageId !== `page-${value.page}`)
      ctx.addIssue({ code: 'custom', path: ['pageId'], message: 'Inconsistent page anchor.' });
    if ((value.assetKey === null) !== (value.asset !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['asset'],
        message: 'Custom sticker asset is required.',
      });
    if (
      value.asset &&
      (value.asset.bytes !== value.assetBytes || value.asset.digest !== value.assetDigest)
    )
      ctx.addIssue({ code: 'custom', path: ['asset'], message: 'Sticker metadata mismatch.' });
  });

const transferRecipeFields = {
  sourceId: id,
  sourceRevision: z.number().int().positive(),
  visibility: recipeVisibilitySchema,
  status: recipeStatusSchema,
  content: recipeContentSchema,
  ingredients: z
    .array(
      z.strictObject({
        sourceId: id,
        ...orderedFields,
        name: z.string().trim().min(1).max(200),
        quantityValue: z.number().positive().max(1e9).nullable(),
        quantityText: z.string().trim().max(100),
        unit: z.string().trim().max(50),
        note: z.string().trim().max(1000),
        isOptional: z.boolean(),
      }),
    )
    .max(RECIPE_LIMITS.ingredients),
  steps: z
    .array(
      z.strictObject({
        sourceId: id,
        ...orderedFields,
        body: z.string().trim().min(1).max(RECIPE_LIMITS.stepBody),
        durationSeconds: z.number().int().min(0).max(31536000).nullable(),
      }),
    )
    .max(RECIPE_LIMITS.steps),
  tags: z
    .array(
      z.strictObject({
        sourceId: id,
        name: z.string().trim().min(1).max(80),
        colorToken: z.enum(['neutral', 'accent', 'success', 'warning', 'danger']),
      }),
    )
    .max(RECIPE_LIMITS.tags),
  photos: z
    .array(
      z.strictObject({
        sourceId: id,
        kind: recipePhotoKindSchema,
        stepSourceId: id.nullable(),
        position: z.number().int().min(0).max(RECIPE_LIMITS.photos),
        width: z.number().int().positive().max(PHOTO_LIMITS.imageEdge),
        height: z.number().int().positive().max(PHOTO_LIMITS.imageEdge),
        image: recipeTransferFileSchema,
        thumbnail: thumbnailFileSchema,
      }),
    )
    .max(RECIPE_LIMITS.photos),
};

const legacyRecipeTransferRecipeObject = z.strictObject(transferRecipeFields);
const refineRecipe = (
  recipe: z.infer<typeof legacyRecipeTransferRecipeObject>,
  ctx: z.RefinementCtx,
) => {
  const unique = (values: (string | number)[]) => new Set(values).size === values.length;
  const stepIds = new Set(recipe.steps.map((step: { sourceId: string }) => step.sourceId));
  if (
    !unique(recipe.ingredients.map((row: { sourceId: string }) => row.sourceId)) ||
    !unique(recipe.ingredients.map((row: { position: number }) => row.position))
  )
    ctx.addIssue({ code: 'custom', path: ['ingredients'], message: 'Duplicate source ID.' });
  if (
    !unique(recipe.steps.map((row: { sourceId: string }) => row.sourceId)) ||
    !unique(recipe.steps.map((row: { position: number }) => row.position))
  )
    ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Duplicate source ID.' });
  if (
    !unique(recipe.tags.map((row: { sourceId: string }) => row.sourceId)) ||
    !unique(recipe.tags.map((row: { name: string }) => normalizeTagName(row.name)))
  )
    ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Duplicate source ID.' });
  if (!unique(recipe.photos.map((row: { sourceId: string }) => row.sourceId)))
    ctx.addIssue({ code: 'custom', path: ['photos'], message: 'Duplicate source ID.' });
  for (const [index, photo] of recipe.photos.entries())
    if (
      (photo.kind === 'step') !== (photo.stepSourceId !== null) ||
      (photo.stepSourceId !== null && !stepIds.has(photo.stepSourceId)) ||
      (photo.kind === 'cover' && photo.position !== 0)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['photos', index, 'stepSourceId'],
        message: 'Invalid step photo reference.',
      });
  const groups = new Map<string, number[]>();
  for (const photo of recipe.photos) {
    const group = photo.kind === 'step' ? `step:${photo.stepSourceId}` : photo.kind;
    groups.set(group, [...(groups.get(group) ?? []), photo.position]);
  }
  if (
    (groups.get('cover')?.length ?? 0) > 1 ||
    (groups.get('gallery')?.length ?? 0) > RECIPE_LIMITS.galleryPhotos ||
    [...groups].some(
      ([group, positions]) =>
        !unique(positions) ||
        (group.startsWith('step:') && positions.length > RECIPE_LIMITS.stepPhotos),
    )
  )
    ctx.addIssue({ code: 'custom', path: ['photos'], message: 'Invalid photo order.' });
};

const legacyRecipeTransferRecipeSchema = legacyRecipeTransferRecipeObject.superRefine(refineRecipe);
const recipeTransferRecipeV2Schema = z
  .strictObject({
    ...transferRecipeFields,
    presentation: recipeTemplateSnapshotSchema.nullable(),
    stickers: z.array(recipeTransferStickerSchema).max(STICKER_LIMITS.placementsPerRecipe),
  })
  .superRefine(refineRecipe)
  .superRefine((recipe, ctx) => {
    if (new Set(recipe.stickers.map((sticker) => sticker.sourceId)).size !== recipe.stickers.length)
      ctx.addIssue({ code: 'custom', path: ['stickers'], message: 'Duplicate source ID.' });
  });

export const recipeTransferRecipeSchema = z
  .strictObject({
    ...transferRecipeFields,
    presentation: recipeTemplateSnapshotSchema.nullable(),
    design: recipeDesignValueSchema,
    stickers: z.array(recipeTransferStickerSchema).max(STICKER_LIMITS.placementsPerRecipe),
  })
  .superRefine(refineRecipe)
  .superRefine((recipe, ctx) => {
    if (new Set(recipe.stickers.map((sticker) => sticker.sourceId)).size !== recipe.stickers.length)
      ctx.addIssue({ code: 'custom', path: ['stickers'], message: 'Duplicate source ID.' });
    if (recipe.presentation && recipe.presentation.layout !== recipe.design.layout)
      ctx.addIssue({
        code: 'custom',
        path: ['design', 'layout'],
        message: 'Presentation and design layouts differ.',
      });
    if (!recipe.presentation && recipe.design.layout !== 'hearth')
      ctx.addIssue({
        code: 'custom',
        path: ['design', 'layout'],
        message: 'A detached portable design must use the safe default layout.',
      });
  });

const recipeTransferDocumentV3Schema = z
  .strictObject({
    format: z.literal(RECIPE_TRANSFER_FORMAT),
    version: z.literal(3),
    kind: z.enum(['recipe', 'book']),
    exportedAt: z.iso.datetime(),
    recipes: z.array(recipeTransferRecipeSchema).min(1).max(10000),
  })
  .superRefine((document, ctx) => {
    if (document.kind === 'recipe' && document.recipes.length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['recipes'],
        message: 'Recipe export must contain one item.',
      });
    if (new Set(document.recipes.map((recipe) => recipe.sourceId)).size !== document.recipes.length)
      ctx.addIssue({ code: 'custom', path: ['recipes'], message: 'Duplicate recipe source ID.' });
  });

const recipeTransferDocumentV2Schema = z
  .strictObject({
    format: z.literal(RECIPE_TRANSFER_FORMAT),
    version: z.literal(2),
    kind: z.enum(['recipe', 'book']),
    exportedAt: z.iso.datetime(),
    recipes: z.array(recipeTransferRecipeV2Schema).min(1).max(10000),
  })
  .superRefine((document, ctx) => {
    if (document.kind === 'recipe' && document.recipes.length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['recipes'],
        message: 'Recipe export must contain one item.',
      });
    if (new Set(document.recipes.map((recipe) => recipe.sourceId)).size !== document.recipes.length)
      ctx.addIssue({ code: 'custom', path: ['recipes'], message: 'Duplicate recipe source ID.' });
  });

const recipeTransferDocumentV1Schema = z
  .strictObject({
    format: z.literal(RECIPE_TRANSFER_FORMAT),
    version: z.literal(1),
    kind: z.enum(['recipe', 'book']),
    exportedAt: z.iso.datetime(),
    recipes: z.array(legacyRecipeTransferRecipeSchema).min(1).max(10000),
  })
  .superRefine((document, ctx) => {
    if (document.kind === 'recipe' && document.recipes.length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['recipes'],
        message: 'Recipe export must contain one item.',
      });
    if (new Set(document.recipes.map((recipe) => recipe.sourceId)).size !== document.recipes.length)
      ctx.addIssue({ code: 'custom', path: ['recipes'], message: 'Duplicate recipe source ID.' });
  });

export const recipeTransferDocumentSchema = z
  .union([
    recipeTransferDocumentV3Schema,
    recipeTransferDocumentV2Schema,
    recipeTransferDocumentV1Schema,
  ])
  .transform((document) => {
    if (document.version === 3) return document;
    const legacyRecipes =
      document.version === 2
        ? document.recipes.map((recipe) => ({
            ...recipe,
            presentation: recipe.presentation,
            stickers: recipe.stickers,
          }))
        : document.recipes.map((recipe) => ({
            ...recipe,
            presentation: null,
            stickers: [],
          }));
    return {
      ...document,
      version: 3 as const,
      recipes: legacyRecipes.map((recipe) => {
        const presentation = recipe.presentation;
        return {
          ...recipe,
          presentation,
          design: {
            version: RECIPE_DESIGN_VERSION,
            layout: presentation?.layout ?? 'hearth',
            layoutVersion: RECIPE_LAYOUT_VERSION,
            layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
            theme: presentation?.theme ?? DEFAULT_RECIPE_THEME,
            elements: [],
          },
        };
      }),
    };
  });

export type RecipeTransferDocument = z.infer<typeof recipeTransferDocumentSchema>;
export type RecipeTransferRecipe = z.infer<typeof recipeTransferRecipeSchema>;
export type RecipeTransferSticker = z.infer<typeof recipeTransferStickerSchema>;
