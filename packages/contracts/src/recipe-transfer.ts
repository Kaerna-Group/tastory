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

export const RECIPE_TRANSFER_FORMAT = 'tastory.recipe-book' as const;
export const RECIPE_TRANSFER_VERSION = 1 as const;
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
export const recipeTransferRecipeSchema = z
  .strictObject({
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
  })
  .superRefine((recipe, ctx) => {
    const unique = (values: (string | number)[]) => new Set(values).size === values.length;
    const stepIds = new Set(recipe.steps.map((step) => step.sourceId));
    if (
      !unique(recipe.ingredients.map((row) => row.sourceId)) ||
      !unique(recipe.ingredients.map((row) => row.position))
    )
      ctx.addIssue({ code: 'custom', path: ['ingredients'], message: 'Duplicate source ID.' });
    if (
      !unique(recipe.steps.map((row) => row.sourceId)) ||
      !unique(recipe.steps.map((row) => row.position))
    )
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Duplicate source ID.' });
    if (
      !unique(recipe.tags.map((row) => row.sourceId)) ||
      !unique(recipe.tags.map((row) => normalizeTagName(row.name)))
    )
      ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Duplicate source ID.' });
    if (!unique(recipe.photos.map((row) => row.sourceId)))
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
  });

export const recipeTransferDocumentSchema = z
  .strictObject({
    format: z.literal(RECIPE_TRANSFER_FORMAT),
    version: z.literal(RECIPE_TRANSFER_VERSION),
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

export type RecipeTransferDocument = z.infer<typeof recipeTransferDocumentSchema>;
export type RecipeTransferRecipe = z.infer<typeof recipeTransferRecipeSchema>;
