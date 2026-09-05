import { z } from 'zod';

export const TEMPLATE_LIMITS = {
  perUser: 30,
  listPage: 100,
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
  'pastel-notebook',
  'berry-diary',
  'lined-notebook',
  'clean-card',
  'coffeehouse',
  'tea-ceremony',
  'cocktail-night',
  'fresh-bar',
  'wine-cellar',
]);

const themeColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
export const recipeThemeSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  mode: z.enum(['light', 'dark']),
  palette: z.strictObject({
    background: themeColorSchema,
    surface: themeColorSchema,
    text: themeColorSchema,
    muted: themeColorSchema,
    border: themeColorSchema,
    primary: themeColorSchema,
    primaryText: themeColorSchema,
    accent: themeColorSchema,
  }),
  fontPair: z.enum(['literary', 'modern', 'humanist']),
  paper: z.enum(['plain', 'linen', 'dots', 'grid']),
});

export const DEFAULT_RECIPE_THEME = recipeThemeSchema.parse({
  name: 'Тёплая бумага',
  mode: 'light',
  palette: {
    background: '#f4efe7',
    surface: '#fffdf8',
    text: '#302a25',
    muted: '#695f57',
    border: '#d8ccbd',
    primary: '#a74459',
    primaryText: '#ffffff',
    accent: '#8a5b00',
  },
  fontPair: 'literary',
  paper: 'plain',
});

export const recipeTemplateSnapshotSchema = z
  .strictObject({
    templateName: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
    category: templateCategorySchema,
    layout: templateLayoutSchema,
    theme: recipeThemeSchema,
  })
  .refine((value) => value.category === templateCategoryForLayout(value.layout));

export const dishTemplateLayouts = [
  'hearth',
  'bistro',
  'herbarium',
  'celebration',
  'notebook',
  'pastel-notebook',
  'berry-diary',
  'lined-notebook',
  'clean-card',
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

export const recipeTemplateSchema = z
  .strictObject({
    id,
    recipeId: id,
    templateId: id.nullable(),
    templateName: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
    category: templateCategorySchema,
    layout: templateLayoutSchema,
    theme: recipeThemeSchema,
    sourceOwnerUserId: id.nullable(),
    revision,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine((value) => value.category === templateCategoryForLayout(value.layout));

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
  // Optional only for the rolling upgrade from template API v1. The server accepts an omitted
  // presentation revision solely when the recipe has never had an applied template.
  expectedRecipeTemplateRevision: revision.nullable().optional(),
  templateId: id,
  theme: recipeThemeSchema,
  // Added by template API v3. Both fields are omitted by legacy clients; v3 clients send both.
  expectedRecipeDesignRevision: revision.nullable().optional(),
});
export const recipeTemplateRestoreSchema = z.strictObject({
  recipeId: id,
  expectedRecipeRevision: revision,
  expectedRecipeTemplateRevision: revision.nullable().optional(),
  snapshot: recipeTemplateSnapshotSchema,
  expectedRecipeDesignRevision: revision.nullable().optional(),
});

export type RecipeTemplate = z.infer<typeof recipeTemplateSchema>;
export type RecipeTemplateCategory = z.infer<typeof templateCategorySchema>;
export type RecipeTemplateLayout = z.infer<typeof templateLayoutSchema>;
export type RecipeTheme = z.infer<typeof recipeThemeSchema>;
export type RecipeTemplateSnapshot = z.infer<typeof recipeTemplateSnapshotSchema>;
export type RecipeTemplateRecord = z.infer<typeof templateSchema>;
export type RecipeTemplateView = z.infer<typeof templateViewSchema>;
