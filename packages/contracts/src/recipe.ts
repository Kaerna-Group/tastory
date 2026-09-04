import { z } from 'zod';

export const RECIPE_LIMITS = {
  ingredients: 200,
  steps: 100,
  tags: 30,
  title: 200,
  description: 4000,
  notes: 10000,
  stepBody: 10000,
  photos: 60,
  galleryPhotos: 20,
  stepPhotos: 5,
} as const;

const id = z.uuid();
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const minutes = z.number().int().min(0).max(525600).nullable();
const auditFields = {
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision,
};
const orderedFields = {
  sectionTitle: z.string().trim().max(200),
  position: z.number().int().min(0).max(10000),
};
const validDates = (value: { createdAt: string; updatedAt: string }) =>
  Date.parse(value.updatedAt) >= Date.parse(value.createdAt);
const ingredientFields = {
  ...orderedFields,
  name: z.string().trim().min(1).max(200),
  quantityValue: z.number().positive().max(1e9).nullable(),
  quantityText: z.string().trim().max(100),
  unit: z.string().trim().max(50),
  note: z.string().trim().max(1000),
  isOptional: z.boolean(),
};
const stepFields = {
  ...orderedFields,
  body: z.string().trim().min(1).max(RECIPE_LIMITS.stepBody),
  durationSeconds: z.number().int().min(0).max(31536000).nullable(),
};
export const recipeVisibilitySchema = z.enum(['private', 'workspace']);
export const recipeStatusSchema = z.enum(['draft', 'published', 'archived', 'deleted']);
// Apps Script has no browser URL constructor. Validate source links without platform globals.
const sourceUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    const match =
      /^https?:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])(?::([0-9]{1,5}))?(?:[/?#][^\s\\]*)?$/i.exec(
        value,
      );
    return (
      match !== null &&
      (match[1] === undefined || Number(match[1]) <= 65535) &&
      [...value].every(
        (character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127,
      )
    );
  });
export const recipeContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(RECIPE_LIMITS.title),
  description: z.string().trim().max(RECIPE_LIMITS.description),
  servings: z.number().positive().max(100000).nullable(),
  prepMinutes: minutes,
  cookMinutes: minutes,
  sourceUrl: sourceUrlSchema,
  notes: z.string().trim().max(RECIPE_LIMITS.notes),
});

export const recipeSchema = recipeContentSchema
  .extend({
    id,
    workspaceId: id,
    ownerUserId: id,
    visibility: recipeVisibilitySchema,
    status: recipeStatusSchema,
    ...auditFields,
    deletedAt: z.iso.datetime().nullable(),
  })
  .refine(validDates, 'Recipe dates are inconsistent.')
  .refine(
    (recipe) =>
      recipe.status === 'deleted'
        ? recipe.deletedAt !== null &&
          Date.parse(recipe.deletedAt) >= Date.parse(recipe.createdAt) &&
          Date.parse(recipe.deletedAt) <= Date.parse(recipe.updatedAt)
        : recipe.deletedAt === null,
    'Deleted status and timestamp must agree.',
  );

export const recipeIngredientSchema = z
  .strictObject({ id, recipeId: id, ...ingredientFields, ...auditFields })
  .refine(validDates);
export const recipeStepSchema = z
  .strictObject({ id, recipeId: id, ...stepFields, ...auditFields })
  .refine(validDates);
export const recipePhotoKindSchema = z.enum(['cover', 'gallery', 'step']);
export const recipePhotoSchema = z
  .strictObject({
    id,
    recipeId: id,
    kind: recipePhotoKindSchema,
    stepId: id.nullable(),
    position: z.number().int().min(0).max(RECIPE_LIMITS.photos),
    width: z.number().int().positive().max(1600),
    height: z.number().int().positive().max(1600),
    bytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024),
    thumbnailBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024),
    imageDigest: z.string().regex(/^[a-f0-9]{64}$/),
    thumbnailDigest: z.string().regex(/^[a-f0-9]{64}$/),
    ...auditFields,
  })
  .refine(validDates)
  .refine((photo) => (photo.kind === 'step') === (photo.stepId !== null));

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
export const tagInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  colorToken: z.enum(['neutral', 'accent', 'success', 'warning', 'danger']),
});
export const tagSchema = tagInputSchema
  .extend({
    id,
    workspaceId: id,
    normalizedName: z.string().min(1).max(80),
    createdBy: id,
    status: z.enum(['active', 'archived']),
    ...auditFields,
  })
  .refine(validDates)
  .refine((tag) => tag.normalizedName === normalizeTagName(tag.name));
export const recipeTagSchema = z
  .strictObject({ recipeId: id, tagId: id, assignedBy: id, ...auditFields })
  .refine(validDates);

const unique = (values: readonly (string | number)[]) => new Set(values).size === values.length;
export const recipeAggregateSchema = z
  .strictObject({
    recipe: recipeSchema,
    ingredients: z.array(recipeIngredientSchema).max(RECIPE_LIMITS.ingredients),
    steps: z.array(recipeStepSchema).max(RECIPE_LIMITS.steps),
    photos: z.array(recipePhotoSchema).max(RECIPE_LIMITS.photos),
    tags: z.array(tagSchema).max(RECIPE_LIMITS.tags),
    recipeTags: z.array(recipeTagSchema).max(RECIPE_LIMITS.tags),
  })
  .superRefine((aggregate, ctx) => {
    const { recipe, ingredients, steps, photos, tags, recipeTags } = aggregate;
    for (const [path, rows] of [
      ['ingredients', ingredients],
      ['steps', steps],
    ] as const) {
      if (
        !unique(rows.map((row) => row.id)) ||
        !unique(rows.map((row) => row.position)) ||
        rows.some((row) => row.recipeId !== recipe.id)
      )
        ctx.addIssue({ code: 'custom', path: [path], message: 'Invalid child identity or order.' });
    }
    const stepIds = new Set(steps.map((step) => step.id));
    const groups = new Map<string, number[]>();
    for (const photo of photos) {
      const key = photo.kind === 'step' ? `step:${photo.stepId}` : photo.kind;
      groups.set(key, [...(groups.get(key) ?? []), photo.position]);
    }
    if (
      !unique(photos.map((photo) => photo.id)) ||
      photos.some(
        (photo) =>
          photo.recipeId !== recipe.id ||
          (photo.kind === 'step' && !stepIds.has(photo.stepId ?? '')),
      ) ||
      (groups.get('cover')?.length ?? 0) > 1 ||
      (groups.get('gallery')?.length ?? 0) > RECIPE_LIMITS.galleryPhotos ||
      [...groups].some(
        ([key, positions]) =>
          !unique(positions) ||
          (key.startsWith('step:') && positions.length > RECIPE_LIMITS.stepPhotos),
      )
    )
      ctx.addIssue({ code: 'custom', path: ['photos'], message: 'Invalid recipe photos.' });
    const tagIds = new Set(tags.map((tag) => tag.id));
    if (
      !unique(tags.map((tag) => tag.id)) ||
      !unique(tags.map((tag) => tag.normalizedName)) ||
      tags.some((tag) => tag.workspaceId !== recipe.workspaceId) ||
      !unique(recipeTags.map((link) => link.tagId)) ||
      recipeTags.length !== tags.length ||
      recipeTags.some((link) => link.recipeId !== recipe.id || !tagIds.has(link.tagId))
    )
      ctx.addIssue({ code: 'custom', path: ['recipeTags'], message: 'Invalid tag relationship.' });
  });

// Write inputs cannot set ownership, parent IDs, revisions or server timestamps.
const ingredientInputSchema = z.strictObject({ id: id.optional(), ...ingredientFields });
const stepInputSchema = z.strictObject({ id: id.optional(), ...stepFields });
export const recipeWriteContentSchema = z
  .strictObject({
    content: recipeContentSchema,
    ingredients: z.array(ingredientInputSchema).max(RECIPE_LIMITS.ingredients),
    steps: z.array(stepInputSchema).max(RECIPE_LIMITS.steps),
    tagIds: z.array(id).max(RECIPE_LIMITS.tags),
  })
  .superRefine((input, ctx) => {
    for (const [path, rows] of [
      ['ingredients', input.ingredients],
      ['steps', input.steps],
    ] as const) {
      if (
        !unique(rows.flatMap((row) => (row.id ? [row.id] : []))) ||
        !unique(rows.map((row) => row.position))
      )
        ctx.addIssue({ code: 'custom', path: [path], message: 'Duplicate child ID or position.' });
    }
    if (!unique(input.tagIds))
      ctx.addIssue({ code: 'custom', path: ['tagIds'], message: 'Duplicate tag ID.' });
  });
export const recipeCreateInputSchema = z
  .strictObject({
    value: recipeWriteContentSchema,
    visibility: recipeVisibilitySchema.default('private'),
  })
  .refine(
    (input) => [...input.value.ingredients, ...input.value.steps].every((child) => !child.id),
    'New child IDs are assigned by the server.',
  );
export const recipeUpdateInputSchema = z.strictObject({
  recipeId: id,
  expectedRevision: revision,
  value: recipeWriteContentSchema,
});

// Explicit projection prevents notes and child content from entering library/search responses.
export const recipeSummarySchema = z.strictObject({
  id,
  workspaceId: id,
  ownerUserId: id,
  title: z.string().min(1).max(RECIPE_LIMITS.title),
  description: z.string().max(RECIPE_LIMITS.description),
  servings: z.number().positive().max(100000).nullable(),
  prepMinutes: minutes,
  cookMinutes: minutes,
  visibility: recipeVisibilitySchema,
  status: recipeStatusSchema,
  ingredientNames: z.array(z.string().min(1).max(200)).max(RECIPE_LIMITS.ingredients).default([]),
  tags: z
    .array(
      z.strictObject({
        id,
        name: z.string().trim().min(1).max(80),
        colorToken: z.enum(['neutral', 'accent', 'success', 'warning', 'danger']),
      }),
    )
    .max(RECIPE_LIMITS.tags)
    .default([]),
  coverPhotoId: id.nullable().default(null),
  favorite: z.boolean().default(false),
  ...auditFields,
});

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type RecipePhoto = z.infer<typeof recipePhotoSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type RecipeTag = z.infer<typeof recipeTagSchema>;
export type RecipeAggregate = z.infer<typeof recipeAggregateSchema>;
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;
export type RecipeCreateInput = z.infer<typeof recipeCreateInputSchema>;
export type RecipeUpdateInput = z.infer<typeof recipeUpdateInputSchema>;

// Local drafts allow unfinished text; server writes still use recipeWriteContentSchema.
export const recipeDraftValueSchema = z
  .strictObject({
    content: recipeContentSchema.extend({
      servings: z.number().nullable(),
      prepMinutes: z.number().nullable(),
      cookMinutes: z.number().nullable(),
      title: z.string().max(RECIPE_LIMITS.title),
      description: z.string().max(RECIPE_LIMITS.description),
      notes: z.string().max(RECIPE_LIMITS.notes),
      sourceUrl: z.string().max(2048),
    }),
    ingredients: z
      .array(
        ingredientInputSchema.extend({
          key: id,
          name: z.string().max(200),
          sectionTitle: z.string().max(200),
          quantityText: z.string().max(100),
          unit: z.string().max(50),
          note: z.string().max(1000),
        }),
      )
      .max(RECIPE_LIMITS.ingredients),
    steps: z
      .array(
        stepInputSchema.extend({
          key: id,
          durationSeconds: z.number().nullable(),
          body: z.string().max(RECIPE_LIMITS.stepBody),
          sectionTitle: z.string().max(200),
        }),
      )
      .max(RECIPE_LIMITS.steps),
    tagIds: z.array(id).max(RECIPE_LIMITS.tags),
  })
  .refine(
    (value) =>
      unique(value.ingredients.map((row) => row.key)) &&
      unique(value.steps.map((row) => row.key)) &&
      unique(value.tagIds),
  );
export type RecipeDraftValue = z.infer<typeof recipeDraftValueSchema>;
