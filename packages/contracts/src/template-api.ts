import { z } from 'zod';
import {
  TEMPLATE_LIMITS,
  recipeTemplateApplySchema,
  recipeTemplateRestoreSchema,
  recipeTemplateSchema,
  templateCloneSchema,
  templateCreateSchema,
  templateRevisionSchema,
  templateUpdateSchema,
  templateViewSchema,
} from './template';
import {
  recipeDesignSaveSchema,
  recipeDesignSchema,
  recipeDesignValueSchema,
} from './recipe-design';

export const TEMPLATE_API_CAPABILITIES = {
  kind: 'templateCapabilities',
  protocolVersion: 3,
  durableMutationReplay: true,
  recipeTemplateRevisionConflict: true,
  paginatedLibrary: true,
  durableRecipeDesigns: true,
} as const;

export const templateCapabilitiesSchema = z.strictObject({
  kind: z.literal('templateCapabilities'),
  protocolVersion: z.literal(3),
  durableMutationReplay: z.literal(true),
  recipeTemplateRevisionConflict: z.literal(true),
  paginatedLibrary: z.literal(true),
  durableRecipeDesigns: z.literal(true),
});

const templateListPayloadSchema = z
  .strictObject({
    query: z.string().trim().max(TEMPLATE_LIMITS.search).default(''),
    category: z.enum(['all', 'dish', 'drink']).default('all'),
    scope: z.enum(['all', 'mine', 'community']).default('all'),
    includeArchived: z.boolean().default(false),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(TEMPLATE_LIMITS.listPage).optional(),
  })
  .refine((value) => (value.offset === undefined) === (value.limit === undefined));

export const templateCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('templates.capabilities'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('templates.list'),
    payload: templateListPayloadSchema,
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
    payload: recipeTemplateApplySchema.extend({ design: recipeDesignValueSchema.optional() }),
  }),
  z.strictObject({
    action: z.literal('recipes.template.restore'),
    payload: recipeTemplateRestoreSchema.extend({ design: recipeDesignValueSchema.optional() }),
  }),
  z.strictObject({
    action: z.literal('recipes.design.get'),
    payload: z.strictObject({ recipeId: z.uuid() }),
  }),
  z.strictObject({ action: z.literal('recipes.design.save'), payload: recipeDesignSaveSchema }),
]);

export const templateMutationActions = [
  'templates.create',
  'templates.update',
  'templates.archive',
  'templates.restore',
  'templates.clone',
  'recipes.template.apply',
  'recipes.template.restore',
  'recipes.design.save',
] as const;

export const templateDataSchema = z.discriminatedUnion('kind', [
  templateCapabilitiesSchema,
  z.strictObject({
    kind: z.literal('templateLibrary'),
    templates: z.array(templateViewSchema).max(TEMPLATE_LIMITS.listPage),
    // v1 responses omit this field; v2 paginated requests always receive it.
    nextOffset: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
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
  z.strictObject({
    kind: z.literal('recipeDesign'),
    recipeId: z.uuid(),
    design: recipeDesignSchema.nullable(),
    outcome: z.enum(['read', 'committed', 'replayed']),
  }),
]);

export type TemplateCommand = z.infer<typeof templateCommandSchema>;
export type TemplateData = z.infer<typeof templateDataSchema>;
export type TemplateCapabilities = z.infer<typeof templateCapabilitiesSchema>;
