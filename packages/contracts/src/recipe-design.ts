import { z } from 'zod';
import { recipePageBindingSchema, recipePageRegionSchema } from './recipe-page';
import { recipeThemeSchema, templateLayoutSchema } from './template';

export const RECIPE_DESIGN_VERSION = 1 as const;
export const RECIPE_LAYOUT_VERSION = 1 as const;
export const RECIPE_LAYOUT_ALGORITHM_VERSION = 1 as const;
export const RECIPE_DESIGN_LIMITS = {
  elements: 24,
  elementIdBytes: 36,
} as const;

const id = z.uuid();
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const finite = z.number().refine(Number.isFinite, 'Expected a finite number.');
const percent = finite.min(0).max(100);

/**
 * Author-owned geometry for a semantic page region. It never contains recipe text or rendered
 * markup. Pagination may repeat a binding on several physical pages, all derived from this one
 * stable element.
 */
export const recipeDesignElementSchema = z
  .strictObject({
    id,
    binding: recipePageBindingSchema,
    region: recipePageRegionSchema,
    x: percent,
    y: percent,
    width: finite.positive().max(100),
    height: finite.positive().max(100),
    rotation: finite.min(-180).max(180),
    zIndex: z.number().int().min(0).max(100),
    locked: z.boolean(),
  })
  .refine((element) => element.x + element.width <= 100, 'Element exceeds page width.')
  .refine((element) => element.y + element.height <= 100, 'Element exceeds page height.');

export const recipeDesignValueSchema = z
  .strictObject({
    version: z.literal(RECIPE_DESIGN_VERSION),
    layout: templateLayoutSchema,
    layoutVersion: z.literal(RECIPE_LAYOUT_VERSION),
    layoutAlgorithmVersion: z.literal(RECIPE_LAYOUT_ALGORITHM_VERSION),
    theme: recipeThemeSchema,
    elements: z.array(recipeDesignElementSchema).max(RECIPE_DESIGN_LIMITS.elements),
  })
  .superRefine((value, context) => {
    if (new Set(value.elements.map((element) => element.id)).size !== value.elements.length)
      context.addIssue({ code: 'custom', path: ['elements'], message: 'Duplicate element ID.' });
    if (new Set(value.elements.map((element) => element.binding)).size !== value.elements.length)
      context.addIssue({
        code: 'custom',
        path: ['elements'],
        message: 'Duplicate semantic binding.',
      });
  });

export const recipeDesignSchema = z.strictObject({
  id,
  recipeId: id,
  revision,
  recipeTemplateRevision: revision.nullable(),
  sourceTemplateId: id.nullable(),
  sourceTemplateRevision: revision.nullable(),
  value: recipeDesignValueSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const recipeDesignSaveSchema = z.strictObject({
  recipeId: id,
  expectedRevision: revision.nullable(),
  value: recipeDesignValueSchema,
});

export type RecipeDesignElement = z.infer<typeof recipeDesignElementSchema>;
export type RecipeDesignValue = z.infer<typeof recipeDesignValueSchema>;
export type RecipeDesign = z.infer<typeof recipeDesignSchema>;
