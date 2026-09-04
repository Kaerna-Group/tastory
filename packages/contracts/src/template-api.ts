import { z } from 'zod';
import {
  TEMPLATE_LIMITS,
  recipeTemplateApplySchema,
  recipeTemplateSchema,
  templateCloneSchema,
  templateCreateSchema,
  templateRevisionSchema,
  templateUpdateSchema,
  templateViewSchema,
} from './template';

export const templateCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('templates.list'),
    payload: z.strictObject({
      query: z.string().trim().max(TEMPLATE_LIMITS.search).default(''),
      category: z.enum(['all', 'dish', 'drink']).default('all'),
      scope: z.enum(['all', 'mine', 'community']).default('all'),
      includeArchived: z.boolean().default(false),
    }),
  }),
  z.strictObject({ action: z.literal('templates.create'), payload: templateCreateSchema }),
  z.strictObject({ action: z.literal('templates.update'), payload: templateUpdateSchema }),
  z.strictObject({ action: z.literal('templates.archive'), payload: templateRevisionSchema }),
  z.strictObject({ action: z.literal('templates.restore'), payload: templateRevisionSchema }),
  z.strictObject({ action: z.literal('templates.clone'), payload: templateCloneSchema }),
  z.strictObject({
    action: z.literal('recipes.template.get'),
    payload: z.strictObject({ recipeId: z.uuid() }),
  }),
  z.strictObject({
    action: z.literal('recipes.template.apply'),
    payload: recipeTemplateApplySchema,
  }),
]);

export const templateMutationActions = [
  'templates.create',
  'templates.update',
  'templates.archive',
  'templates.restore',
  'templates.clone',
  'recipes.template.apply',
] as const;

export const templateDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('templateLibrary'),
    templates: z.array(templateViewSchema).max(100),
  }),
  templateViewSchema.extend({
    kind: z.literal('template'),
    outcome: z.enum(['committed', 'replayed']),
  }),
  z.strictObject({
    kind: z.literal('recipeTemplate'),
    recipeId: z.uuid(),
    template: recipeTemplateSchema.nullable(),
    outcome: z.enum(['read', 'committed', 'replayed']),
  }),
]);

export type TemplateCommand = z.infer<typeof templateCommandSchema>;
export type TemplateData = z.infer<typeof templateDataSchema>;
