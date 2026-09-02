import { z } from 'zod';

// Conservative staging limits; the final upload strategy follows real measurements.
export const PHOTO_LIMITS = {
  imageBytes: 1024 * 1024,
  thumbnailBytes: 64 * 1024,
  imageEdge: 1600,
  thumbnailEdge: 320,
  sourceBytes: 20 * 1024 * 1024,
  sourcePixels: 40_000_000,
} as const;
export const PHOTO_BODY_LIMIT =
  Math.ceil((PHOTO_LIMITS.imageBytes + PHOTO_LIMITS.thumbnailBytes) / 3) * 4 + 16384;
const base64 = (bytes: number) =>
  z
    .string()
    .min(4)
    .max(Math.ceil(bytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((value) => value.length % 4 === 0);
export const photoUploadSchema = z.strictObject({
  uploadId: z.uuid(),
  imageBase64: base64(PHOTO_LIMITS.imageBytes),
  thumbnailBase64: base64(PHOTO_LIMITS.thumbnailBytes),
});
export const photoInfoSchema = z.strictObject({
  id: z.uuid(),
  width: z.number().int().min(1).max(PHOTO_LIMITS.imageEdge),
  height: z.number().int().min(1).max(PHOTO_LIMITS.imageEdge),
  bytes: z.number().int().min(1).max(PHOTO_LIMITS.imageBytes),
  thumbnailBytes: z.number().int().min(1).max(PHOTO_LIMITS.thumbnailBytes),
  createdAt: z.iso.datetime(),
});
export const photoDataSchema = z.strictObject({
  photo: photoInfoSchema.nullable(),
  thumbnailBase64: base64(PHOTO_LIMITS.thumbnailBytes).nullable(),
});
export type PhotoUpload = z.infer<typeof photoUploadSchema>;
export type PhotoInfo = z.infer<typeof photoInfoSchema>;
export type PhotoData = z.infer<typeof photoDataSchema>;
export type PhotoCommand =
  | { action: 'spike.photo.upload'; payload: PhotoUpload }
  | { action: 'spike.photo.read'; payload: Record<string, never> }
  | { action: 'spike.photo.delete'; payload: { id: string } };
