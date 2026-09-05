import { z } from 'zod';

export const STICKER_LIMITS = {
  packsPerUser: 30,
  stickersPerPack: 100,
  placementsPerRecipe: 200,
  imageBytes: 512 * 1024,
  imageEdge: 1024,
  name: 100,
  search: 100,
} as const;

const id = z.uuid();
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const timestamp = z.iso.datetime();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const emoji = z.string().trim().max(16);

export const stickerVisibilitySchema = z.enum(['private', 'workspace']);
export const stickerPackKindSchema = z.enum(['builtin', 'custom']);
export const stickerStatusSchema = z.enum(['active', 'archived']);
export const stickerMimeSchema = z.enum(['image/png', 'image/webp']);
export const stickerBuiltinAssetSchema = z.enum(['jam', 'tea', 'croissant', 'herbs']);

export const stickerPackSchema = z.strictObject({
  id,
  workspaceId: id.nullable(),
  ownerUserId: id.nullable(),
  kind: stickerPackKindSchema,
  name: z.string().trim().min(1).max(STICKER_LIMITS.name),
  emoji,
  visibility: stickerVisibilitySchema,
  status: stickerStatusSchema,
  position: z.number().int().min(0).max(10000),
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const stickerItemSchema = z.strictObject({
  id,
  packId: id,
  name: z.string().trim().min(1).max(STICKER_LIMITS.name),
  normalizedName: z.string().min(1).max(STICKER_LIMITS.name),
  emoji,
  position: z
    .number()
    .int()
    .min(0)
    .max(STICKER_LIMITS.stickersPerPack - 1),
  mimeType: stickerMimeSchema,
  width: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
  height: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
  bytes: z.number().int().positive().max(STICKER_LIMITS.imageBytes),
  digest,
  assetKey: stickerBuiltinAssetSchema.nullable(),
  status: stickerStatusSchema,
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const stickerUploadSchema = z.strictObject({
  uploadId: id,
  base64: z
    .string()
    .min(4)
    .max(Math.ceil(STICKER_LIMITS.imageBytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((value) => value.length % 4 === 0),
  mimeType: stickerMimeSchema,
  width: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
  height: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
  bytes: z.number().int().positive().max(STICKER_LIMITS.imageBytes),
});

const geometry = {
  page: z.number().int().min(1).max(100),
  // A4 physical-sheet slots are stable within one recipe, independent of screen width.
  // Numeric page remains the lossless storage/legacy representation of the same anchor.
  pageId: z
    .string()
    .regex(/^page-([1-9][0-9]?|100)$/)
    .optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(2).max(100),
  height: z.number().min(2).max(100),
  rotation: z.number().min(-180).max(180),
  zIndex: z.number().int().min(0).max(10000),
};

export const recipeStickerSchema = z.strictObject({
  id,
  recipeId: id,
  stickerId: id,
  packId: id,
  name: z.string().trim().min(1).max(STICKER_LIMITS.name),
  emoji,
  mimeType: stickerMimeSchema,
  assetWidth: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
  assetHeight: z.number().int().positive().max(STICKER_LIMITS.imageEdge),
  assetBytes: z.number().int().positive().max(STICKER_LIMITS.imageBytes),
  assetDigest: digest,
  assetKey: stickerBuiltinAssetSchema.nullable(),
  ...geometry,
  status: z.enum(['active', 'deleted']),
  revision,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const stickerPackViewSchema = z.strictObject({
  pack: stickerPackSchema,
  stickers: z.array(stickerItemSchema).max(STICKER_LIMITS.stickersPerPack),
  canManage: z.boolean(),
});

export const stickerPackCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(STICKER_LIMITS.name),
  emoji,
  visibility: stickerVisibilitySchema,
});
export const stickerPackUpdateSchema = stickerPackCreateSchema.extend({
  packId: id,
  expectedRevision: revision,
});
export const stickerPackRevisionSchema = z.strictObject({ packId: id, expectedRevision: revision });
export const stickerItemAddSchema = z.strictObject({
  packId: id,
  expectedRevision: revision,
  name: z.string().trim().min(1).max(STICKER_LIMITS.name),
  emoji,
  position: z
    .number()
    .int()
    .min(0)
    .max(STICKER_LIMITS.stickersPerPack - 1),
  upload: stickerUploadSchema,
});
export const stickerReorderSchema = z
  .strictObject({
    packId: id,
    expectedRevision: revision,
    stickerIds: z.array(id).min(1).max(STICKER_LIMITS.stickersPerPack),
  })
  .refine(
    (value) => new Set(value.stickerIds).size === value.stickerIds.length,
    'Duplicate sticker ID.',
  );
export const stickerItemRevisionSchema = z.strictObject({
  packId: id,
  stickerId: id,
  expectedRevision: revision,
});
const consistentPage = (value: { page: number; pageId?: string | undefined }) =>
  value.pageId === undefined || value.pageId === `page-${value.page}`;
export const recipeStickerAddSchema = z
  .strictObject({
    recipeId: id,
    expectedRecipeRevision: revision,
    stickerId: id,
    ...geometry,
  })
  .refine(consistentPage, 'Page ID does not match the physical sheet slot.');
export const recipeStickerUpdateSchema = z
  .strictObject({
    recipeId: id,
    instanceId: id,
    expectedRevision: revision,
    ...geometry,
  })
  .refine(consistentPage, 'Page ID does not match the physical sheet slot.');
export const recipeStickerDeleteSchema = z.strictObject({
  recipeId: id,
  instanceId: id,
  expectedRevision: revision,
});

export function normalizeStickerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}

export type StickerPack = z.infer<typeof stickerPackSchema>;
export type StickerItem = z.infer<typeof stickerItemSchema>;
export type RecipeSticker = z.infer<typeof recipeStickerSchema>;
export type StickerPackView = z.infer<typeof stickerPackViewSchema>;
export type StickerUpload = z.infer<typeof stickerUploadSchema>;
