import { z } from 'zod';
import {
  STICKER_LIMITS,
  recipeStickerAddSchema,
  recipeStickerDeleteSchema,
  recipeStickerSchema,
  recipeStickerUpdateSchema,
  stickerItemAddSchema,
  stickerItemRevisionSchema,
  stickerPackCreateSchema,
  stickerPackRevisionSchema,
  stickerPackUpdateSchema,
  stickerPackViewSchema,
  stickerReorderSchema,
} from './sticker';

export const stickerCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('stickers.packs.list'),
    payload: z.strictObject({
      query: z.string().trim().max(STICKER_LIMITS.search).default(''),
      includeArchived: z.boolean().default(false),
    }),
  }),
  z.strictObject({ action: z.literal('stickers.packs.create'), payload: stickerPackCreateSchema }),
  z.strictObject({ action: z.literal('stickers.packs.update'), payload: stickerPackUpdateSchema }),
  z.strictObject({
    action: z.literal('stickers.packs.archive'),
    payload: stickerPackRevisionSchema,
  }),
  z.strictObject({
    action: z.literal('stickers.packs.restore'),
    payload: stickerPackRevisionSchema,
  }),
  z.strictObject({ action: z.literal('stickers.items.add'), payload: stickerItemAddSchema }),
  z.strictObject({ action: z.literal('stickers.items.reorder'), payload: stickerReorderSchema }),
  z.strictObject({
    action: z.literal('stickers.items.archive'),
    payload: stickerItemRevisionSchema,
  }),
  z.strictObject({
    action: z.literal('stickers.assets.read'),
    payload: z.union([
      z.strictObject({ stickerId: z.uuid() }),
      z.strictObject({ recipeId: z.uuid(), instanceId: z.uuid() }),
    ]),
  }),
  z.strictObject({
    action: z.literal('recipes.stickers.list'),
    payload: z.strictObject({ recipeId: z.uuid() }),
  }),
  z.strictObject({ action: z.literal('recipes.stickers.add'), payload: recipeStickerAddSchema }),
  z.strictObject({
    action: z.literal('recipes.stickers.update'),
    payload: recipeStickerUpdateSchema,
  }),
  z.strictObject({
    action: z.literal('recipes.stickers.delete'),
    payload: recipeStickerDeleteSchema,
  }),
]);

export const stickerMutationActions = [
  'stickers.packs.create',
  'stickers.packs.update',
  'stickers.packs.archive',
  'stickers.packs.restore',
  'stickers.items.add',
  'stickers.items.reorder',
  'stickers.items.archive',
  'recipes.stickers.add',
  'recipes.stickers.update',
  'recipes.stickers.delete',
] as const;

export const stickerDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stickerPacks'),
    packs: z.array(stickerPackViewSchema).max(100),
  }),
  stickerPackViewSchema.extend({
    kind: z.literal('stickerPack'),
    outcome: z.enum(['committed', 'replayed']),
  }),
  z.strictObject({
    kind: z.literal('stickerAsset'),
    mimeType: z.enum(['image/png', 'image/webp']),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(STICKER_LIMITS.imageBytes / 3) * 4),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    kind: z.literal('recipeStickers'),
    recipeId: z.uuid(),
    stickers: z.array(recipeStickerSchema).max(STICKER_LIMITS.placementsPerRecipe),
  }),
  z.strictObject({
    kind: z.literal('recipeSticker'),
    recipeId: z.uuid(),
    sticker: recipeStickerSchema,
    outcome: z.enum(['committed', 'replayed']),
  }),
]);

export type StickerCommand = z.infer<typeof stickerCommandSchema>;
export type StickerData = z.infer<typeof stickerDataSchema>;
