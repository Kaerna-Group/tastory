import { z } from 'zod';

export const TEMPLATE_LIMITS = {
  perUser: 30,
  name: 80,
  description: 240,
  search: 100,
} as const;

const id = z.uuid();
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const timestamp = z.iso.datetime();

export const templateCategorySchema = z.enum(['dish', 'drink']);
export const templateVisibilitySchema = z.enum(['private', 'workspace']);
export const templateKindSchema = z.enum(['builtin', 'custom']);
export const templateStatusSchema = z.enum(['active', 'archived']);
export const templateLayoutSchema = z.enum([
  'hearth',
  'bistro',
  'herbarium',
  'celebration',
  'notebook',
  'coffeehouse',
  'tea-ceremony',
  'cocktail-night',
  'fresh-bar',
  'wine-cellar',
]);

export const dishTemplateLayouts = [
  'hearth',
  'bistro',
  'herbarium',
  'celebration',
  'notebook',
] as const;
export const drinkTemplateLayouts = [
  'coffeehouse',
  'tea-ceremony',
  'cocktail-night',
  'fresh-bar',
  'wine-cellar',
] as const;

export function templateCategoryForLayout(
  layout: z.infer<typeof templateLayoutSchema>,
): z.infer<typeof templateCategorySchema> {
  return (dishTemplateLayouts as readonly string[]).includes(layout) ? 'dish' : 'drink';
}

export const recipeTemplateSchema = z.strictObject({
  id,
  recipeId: id,
  templateId: id,
  templateName: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
  category: templateCategorySchema,
  layout: templateLayoutSchema,
  sourceOwnerUserId: id.nullable(),
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const templateSchema = z
  .strictObject({
    id,
    workspaceId: id.nullable(),
    ownerUserId: id.nullable(),
    kind: templateKindSchema,
    name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
    description: z.string().trim().max(TEMPLATE_LIMITS.description),
    category: templateCategorySchema,
    layout: templateLayoutSchema,
    visibility: templateVisibilitySchema,
    status: templateStatusSchema,
    sourceTemplateId: id.nullable(),
    revision,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine((value) => value.category === templateCategoryForLayout(value.layout));

export const templateViewSchema = z.strictObject({
  template: templateSchema,
  authorName: z.string().trim().min(1).max(200),
  canManage: z.boolean(),
  canCopy: z.boolean(),
});

export const templateCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
  description: z.string().trim().max(TEMPLATE_LIMITS.description),
  layout: templateLayoutSchema,
  visibility: templateVisibilitySchema,
});
export const templateUpdateSchema = templateCreateSchema.extend({
  templateId: id,
  expectedRevision: revision,
});
export const templateRevisionSchema = z.strictObject({
  templateId: id,
  expectedRevision: revision,
});
export const templateCloneSchema = z.strictObject({
  templateId: id,
  expectedRevision: revision,
  name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name).optional(),
  visibility: templateVisibilitySchema.default('private'),
});
export const recipeTemplateApplySchema = z.strictObject({
  recipeId: id,
  expectedRecipeRevision: revision,
  templateId: id,
});

export type RecipeTemplate = z.infer<typeof recipeTemplateSchema>;
export type RecipeTemplateCategory = z.infer<typeof templateCategorySchema>;
export type RecipeTemplateLayout = z.infer<typeof templateLayoutSchema>;
export type RecipeTemplateRecord = z.infer<typeof templateSchema>;
export type RecipeTemplateView = z.infer<typeof templateViewSchema>;
