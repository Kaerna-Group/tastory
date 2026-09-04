import { z } from 'zod';
import {
  recipeAggregateSchema,
  recipeSummarySchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
  tagInputSchema,
  tagSchema,
  recipePhotoSchema,
} from './recipe';
import { photoUploadSchema } from './photo';

export const RECIPE_BODY_LIMIT = 2 * 1024 * 1024;
const entityRevision = z.strictObject({
  recipeId: z.uuid(),
  expectedRevision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
});
const operationId = z.strictObject({ operationId: z.uuid() });
export const recipeCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('recipes.list'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('recipes.version.restore'),
    payload: z.strictObject({
      recipeId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      targetRevision: z.number().int().positive(),
    }),
  }),
  z.strictObject({ action: z.literal('admin.files.audit'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('admin.files.trash'),
    payload: z.strictObject({ fileId: z.string().min(1).max(200) }),
  }),
  z.strictObject({ action: z.literal('admin.files.trashUnused'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('admin.files.restore'),
    payload: z.strictObject({ fileId: z.string().min(1).max(200) }),
  }),
  z.strictObject({ action: z.literal('admin.files.cleanup'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('recipes.favorite.set'),
    payload: z.strictObject({ recipeId: z.uuid(), favorite: z.boolean() }),
  }),
  z.strictObject({
    action: z.literal('recipes.history'),
    payload: z.strictObject({
      recipeId: z.uuid(),
      beforeRevision: z.number().int().positive().optional(),
    }),
  }),
  z.strictObject({
    action: z.literal('recipes.version'),
    payload: z.strictObject({ recipeId: z.uuid(), revision: z.number().int().positive() }),
  }),
  z.strictObject({
    action: z.literal('admin.recipes.archiveHistory'),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    action: z.literal('recipes.get'),
    payload: z.strictObject({ recipeId: z.uuid() }),
  }),
  z.strictObject({ action: z.literal('recipes.create'), payload: recipeCreateInputSchema }),
  z.strictObject({ action: z.literal('recipes.updateContent'), payload: recipeUpdateInputSchema }),
  z.strictObject({ action: z.literal('recipes.archive'), payload: entityRevision }),
  z.strictObject({ action: z.literal('recipes.restore'), payload: entityRevision }),
  z.strictObject({
    action: z.literal('recipes.photos.add'),
    payload: entityRevision.extend({
      photo: photoUploadSchema.extend({
        width: z.number().int().positive().max(1600),
        height: z.number().int().positive().max(1600),
        imageBytes: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024),
        thumbnailBytes: z
          .number()
          .int()
          .positive()
          .max(64 * 1024),
      }),
      target: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('cover'), position: z.literal(0) }),
        z.strictObject({ kind: z.literal('gallery'), position: z.number().int().min(0).max(20) }),
        z.strictObject({
          kind: z.literal('step'),
          stepId: z.uuid(),
          position: z.number().int().min(0).max(5),
        }),
      ]),
    }),
  }),
  z.strictObject({
    action: z.literal('recipes.photos.delete'),
    payload: entityRevision.extend({ photoId: z.uuid() }),
  }),
  z.strictObject({
    action: z.literal('recipes.photos.read'),
    payload: z.strictObject({
      recipeId: z.uuid(),
      photoId: z.uuid(),
      variant: z.enum(['image', 'thumbnail']),
    }),
  }),
  z.strictObject({ action: z.literal('tags.list'), payload: z.strictObject({}) }),
  z.strictObject({ action: z.literal('tags.create'), payload: tagInputSchema }),
  z.strictObject({ action: z.literal('recipes.operations.list'), payload: z.strictObject({}) }),
  z.strictObject({ action: z.literal('recipes.operations.resume'), payload: operationId }),
  z.strictObject({ action: z.literal('recipes.operations.cancel'), payload: operationId }),
  z.strictObject({ action: z.literal('admin.recipes.initialize'), payload: z.strictObject({}) }),
]);
export const recipeMutationActions = [
  'recipes.create',
  'recipes.updateContent',
  'recipes.archive',
  'recipes.restore',
  'recipes.version.restore',
  'recipes.photos.add',
  'recipes.photos.delete',
  'tags.create',
] as const;
export const recipeReceiptSchema = z.strictObject({
  operationId: z.uuid(),
  entityId: z.uuid(),
  entityType: z.enum(['recipe', 'tag']),
  revision: z.number().int().positive(),
  outcome: z.enum(['committed', 'replayed', 'cancelled']),
});
export const recipeDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('files'),
    checkedAt: z.iso.datetime(),
    summary: z.strictObject({
      healthy: z.number().int().nonnegative().max(10000),
      missing: z.number().int().nonnegative().max(10000),
      damaged: z.number().int().nonnegative().max(10000),
      orphaned: z.number().int().nonnegative().max(10000),
      unknown: z.number().int().nonnegative().max(10000),
      trashed: z.number().int().nonnegative().max(10000),
    }),
    items: z
      .array(
        z.strictObject({
          fileId: z.string().min(1).max(200).nullable(),
          name: z.string().min(1).max(500),
          status: z.enum(['missing', 'damaged', 'orphaned', 'unknown', 'trashed']),
          recipeId: z.uuid().nullable(),
        }),
      )
      .max(2000),
  }),
  z.strictObject({
    kind: z.literal('photo'),
    photo: recipePhotoSchema,
    variant: z.enum(['image', 'thumbnail']),
    base64: z.string().min(1).max(1400000),
  }),
  z.strictObject({
    kind: z.literal('history'),
    recipeId: z.uuid(),
    versions: z
      .array(
        z.strictObject({
          revision: z.number().int().positive(),
          action: z.enum(recipeMutationActions),
          completedAt: z.iso.datetime(),
        }),
      )
      .max(50),
    nextBeforeRevision: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    kind: z.literal('archivedHistory'),
    archived: z.number().int().nonnegative(),
    totalArchived: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('recipes'), recipes: z.array(recipeSummarySchema).max(10000) }),
  z.strictObject({
    kind: z.literal('favorite'),
    recipeId: z.uuid(),
    favorite: z.boolean(),
    outcome: z.enum(['committed', 'replayed']),
  }),
  z.strictObject({
    kind: z.literal('recipe'),
    aggregate: recipeAggregateSchema,
    permissions: z
      .strictObject({ edit: z.boolean(), archive: z.boolean(), restore: z.boolean() })
      .optional(),
  }),
  z.strictObject({ kind: z.literal('tags'), tags: z.array(tagSchema).max(10000) }),
  recipeReceiptSchema.extend({ kind: z.literal('saved') }),
  z.strictObject({
    kind: z.literal('initialized'),
    schemaVersion: z.literal(8),
    alreadyApplied: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('operations'),
    operations: z
      .array(
        z.strictObject({
          operationId: z.uuid(),
          entityId: z.uuid(),
          action: z.enum(recipeMutationActions),
          startedAt: z.iso.datetime(),
          canResume: z.boolean(),
        }),
      )
      .max(10000),
  }),
]);
export type RecipeCommand = z.infer<typeof recipeCommandSchema>;
export type RecipeMutation = Extract<
  RecipeCommand,
  { action: (typeof recipeMutationActions)[number] }
>;
export type RecipeData = z.infer<typeof recipeDataSchema>;
export type RecipeReceipt = z.infer<typeof recipeReceiptSchema>;
