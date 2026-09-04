import { z } from 'zod';
import {
  recipeAggregateSchema,
  recipeDraftValueSchema,
  recipeVisibilitySchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
} from './recipe';

const contentCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('recipes.create'), payload: recipeCreateInputSchema }),
  z.strictObject({ action: z.literal('recipes.updateContent'), payload: recipeUpdateInputSchema }),
]);
export const recipeLocalDraftSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    scope: z.string().min(1).max(2048),
    updatedAt: z.iso.datetime(),
    editVersion: z.number().int().nonnegative(),
    savedVersion: z.number().int().min(-1),
    visibility: recipeVisibilitySchema,
    value: recipeDraftValueSchema,
    base: recipeAggregateSchema.nullable(),
    pending: z
      .strictObject({
        requestId: z.uuid(),
        command: contentCommand,
        value: recipeDraftValueSchema,
        editVersion: z.number().int().nonnegative(),
      })
      .nullable(),
    conflict: recipeAggregateSchema.nullable(),
  })
  .refine(
    (draft) =>
      draft.savedVersion <= draft.editVersion &&
      (!draft.pending || draft.pending.editVersion <= draft.editVersion),
  );
export type RecipeLocalDraft = z.infer<typeof recipeLocalDraftSchema>;
