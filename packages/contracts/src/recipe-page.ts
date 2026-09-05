import { z } from 'zod';
import { templateLayoutSchema } from './template';

export const RECIPE_PAGE_DOCUMENT_VERSION = 1 as const;

export const recipePageBindingSchema = z.enum([
  'cover',
  'title',
  'description',
  'meta',
  'ingredients',
  'steps',
  'notes',
  'source',
  'tags',
  'photos',
]);
export const recipePageRegionSchema = z.enum(['header', 'sidebar', 'body', 'footer']);
export const recipePageKindSchema = z.enum(['opening', 'continuation', 'story', 'notes', 'photos']);

const percent = z.number().min(0).max(100);
const elementId = z.string().regex(/^page-[1-9][0-9]*-[a-z]+$/);
const pageId = z.string().regex(/^page-[1-9][0-9]*$/);

export const recipePageElementSchema = z
  .strictObject({
    id: elementId,
    binding: recipePageBindingSchema,
    region: recipePageRegionSchema,
    sourceStart: z.number().int().min(0),
    sourceEnd: z.number().int().min(0),
    continuation: z.boolean(),
    x: percent,
    y: percent,
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
    zIndex: z.number().int().min(0).max(100),
    locked: z.boolean(),
  })
  .refine((element) => element.sourceEnd >= element.sourceStart, 'Invalid source range.')
  .refine((element) => element.x + element.width <= 100, 'Element exceeds page width.')
  .refine((element) => element.y + element.height <= 100, 'Element exceeds page height.');

export const recipePageSchema = z
  .strictObject({
    id: pageId,
    index: z.number().int().min(0),
    kind: recipePageKindSchema,
    widthMm: z.literal(210),
    heightMm: z.literal(297),
    elements: z.array(recipePageElementSchema).min(1).max(12),
  })
  .refine(
    (page) => new Set(page.elements.map((element) => element.id)).size === page.elements.length,
    'Duplicate page element.',
  );

export const recipePageDocumentSchema = z
  .strictObject({
    version: z.literal(RECIPE_PAGE_DOCUMENT_VERSION),
    recipeId: z.uuid(),
    recipeRevision: z.number().int().min(0).nullable(),
    templateId: z.uuid().nullable(),
    templateRevision: z.number().int().min(1),
    layout: templateLayoutSchema,
    pages: z.array(recipePageSchema).min(1).max(5000),
  })
  .superRefine((document, context) => {
    if (
      new Set(document.pages.map((page) => page.id)).size !== document.pages.length ||
      document.pages.some((page, index) => page.index !== index)
    )
      context.addIssue({ code: 'custom', path: ['pages'], message: 'Invalid page order.' });
  });

export type RecipePageBinding = z.infer<typeof recipePageBindingSchema>;
export type RecipePageElement = z.infer<typeof recipePageElementSchema>;
export type RecipePage = z.infer<typeof recipePageSchema>;
export type RecipePageDocument = z.infer<typeof recipePageDocumentSchema>;
