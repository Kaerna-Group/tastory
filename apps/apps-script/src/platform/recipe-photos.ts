import { PHOTO_LIMITS } from '@tastory/contracts';
import type { RecipePhoto } from '@tastory/contracts';
import { inspectJpeg } from '../services/jpeg';
import { PhotoError } from '../services/photo-error';
import { fileInFolder, privateResourceFolder } from './private-resources';

const filename = (recipeId: string, photoId: string, variant: 'image' | 'thumbnail') =>
  `tastory-recipe-${recipeId}-${photoId}-${variant}.jpg`;

function photoBoundary<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    if (error instanceof Error && error.message === 'RESOURCE_NOT_PRIVATE')
      throw new PhotoError('PHOTO_NOT_PRIVATE');
    throw new PhotoError('PHOTO_UNAVAILABLE');
  }
}

function oneFile(folder: GoogleAppsScript.Drive.Folder, name: string) {
  const files = folder.getFilesByName(name);
  if (!files.hasNext()) return null;
  const file = files.next();
  if (files.hasNext()) throw new PhotoError('PHOTO_EXISTS');
  return fileInFolder(file, folder.getId());
}

function checkedBytes(
  file: GoogleAppsScript.Drive.File,
  expectedBytes: number,
  expectedDigest: string,
  edge: number,
  sha256: (value: string) => string,
) {
  if (file.getMimeType() !== 'image/jpeg' || file.getSize() !== expectedBytes)
    throw new PhotoError('PHOTO_INVALID');
  const bytes = file.getBlob().getBytes();
  inspectJpeg(bytes, expectedBytes, edge);
  if (sha256(Utilities.base64Encode(bytes)) !== expectedDigest)
    throw new PhotoError('PHOTO_INVALID');
  return bytes;
}

export function ensureRecipePhoto(
  folderId: string,
  photo: RecipePhoto,
  upload: { imageBase64: string; thumbnailBase64: string },
  sha256: (value: string) => string,
) {
  return photoBoundary(() => {
    const folder = privateResourceFolder(folderId);
    const image = Utilities.base64Decode(upload.imageBase64);
    const thumbnail = Utilities.base64Decode(upload.thumbnailBase64);
    const dimensions = inspectJpeg(image, PHOTO_LIMITS.imageBytes, PHOTO_LIMITS.imageEdge);
    inspectJpeg(thumbnail, PHOTO_LIMITS.thumbnailBytes, PHOTO_LIMITS.thumbnailEdge);
    if (
      dimensions.width !== photo.width ||
      dimensions.height !== photo.height ||
      image.length !== photo.bytes ||
      thumbnail.length !== photo.thumbnailBytes ||
      sha256(upload.imageBase64) !== photo.imageDigest ||
      sha256(upload.thumbnailBase64) !== photo.thumbnailDigest
    )
      throw new PhotoError('PHOTO_INVALID');
    for (const [variant, bytes, expectedBytes, digest, edge] of [
      ['image', image, photo.bytes, photo.imageDigest, PHOTO_LIMITS.imageEdge],
      [
        'thumbnail',
        thumbnail,
        photo.thumbnailBytes,
        photo.thumbnailDigest,
        PHOTO_LIMITS.thumbnailEdge,
      ],
    ] as const) {
      const name = filename(photo.recipeId, photo.id, variant);
      const existing = oneFile(folder, name);
      if (existing) {
        checkedBytes(existing, expectedBytes, digest, edge, sha256);
        continue;
      }
      const created = fileInFolder(
        folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name)),
        folderId,
      );
      checkedBytes(created, expectedBytes, digest, edge, sha256);
    }
  });
}

export function readRecipePhoto(
  folderId: string,
  photo: RecipePhoto,
  variant: 'image' | 'thumbnail',
  sha256: (value: string) => string,
) {
  return photoBoundary(() => {
    const folder = privateResourceFolder(folderId);
    const file = oneFile(folder, filename(photo.recipeId, photo.id, variant));
    if (!file) throw new PhotoError('PHOTO_UNAVAILABLE');
    const bytes = checkedBytes(
      file,
      variant === 'image' ? photo.bytes : photo.thumbnailBytes,
      variant === 'image' ? photo.imageDigest : photo.thumbnailDigest,
      variant === 'image' ? PHOTO_LIMITS.imageEdge : PHOTO_LIMITS.thumbnailEdge,
      sha256,
    );
    return Utilities.base64Encode(bytes);
  });
}
