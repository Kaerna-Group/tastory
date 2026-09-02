import { z } from 'zod';
import { PHOTO_LIMITS, photoInfoSchema } from '@tastory/contracts';
import type { AuthData, PhotoCommand, PhotoData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { inspectJpeg } from '../services/jpeg';
import { PhotoError } from '../services/photo-error';

const recordSchema = z.strictObject({
  ownerSub: z.string().min(1).max(255),
  folderId: z.string().min(1),
  imageId: z.string().min(1),
  thumbnailId: z.string().min(1),
  imageDigest: z.string().length(64),
  thumbnailDigest: z.string().length(64),
  info: photoInfoSchema,
});
const empty: PhotoData = { photo: null, thumbnailBase64: null };
function digest(value: string | number[]) {
  const bytes =
    typeof value === 'string'
      ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
      : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return bytes.map((byte) => (byte & 255).toString(16).padStart(2, '0')).join('');
}
function assertPrivate(item: GoogleAppsScript.Drive.Folder | GoogleAppsScript.Drive.File) {
  if (
    item.getSharingAccess() !== DriveApp.Access.PRIVATE ||
    item.getEditors().length ||
    item.getViewers().length ||
    item.getOwner()?.getEmail() !== Session.getEffectiveUser().getEmail()
  )
    throw new PhotoError('PHOTO_NOT_PRIVATE');
}
function privateFolder(id: string) {
  const folder = DriveApp.getFolderById(id);
  let current = folder;
  for (let depth = 0; depth < 20; depth++) {
    if (current.isTrashed()) throw new PhotoError('PHOTO_UNAVAILABLE');
    assertPrivate(current);
    const parents = current.getParents();
    if (!parents.hasNext()) return folder;
    current = parents.next();
    if (parents.hasNext()) throw new PhotoError('PHOTO_NOT_PRIVATE');
  }
  throw new PhotoError('PHOTO_NOT_PRIVATE');
}
function ownedFile(id: string, folderId: string, expectedName: string, deleting = false) {
  const file = DriveApp.getFileById(id);
  assertPrivate(file);
  if (file.getName() !== expectedName) throw new PhotoError('PHOTO_UNAVAILABLE');
  if (file.isTrashed()) {
    if (deleting) return file;
    throw new PhotoError('PHOTO_UNAVAILABLE');
  }
  const parents = file.getParents();
  if (!parents.hasNext() || parents.next().getId() !== folderId || parents.hasNext())
    throw new PhotoError('PHOTO_NOT_PRIVATE');
  return file;
}
const fileName = (id: string, variant: 'image' | 'thumbnail') =>
  `tastory-spike-${id}-${variant}.jpg`;

export function privatePhoto(command: PhotoCommand, session: AuthData): PhotoData {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('APP_ENV') !== 'staging') throw new PhotoError('PHOTO_UNAVAILABLE');
  if (session.user.role !== 'owner') throw new AuthError('ACCESS_DENIED');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new PhotoError('PHOTO_UNAVAILABLE');
  try {
    if (Date.parse(session.expiresAt) <= Date.now()) throw new AuthError('UNAUTHENTICATED');
    const key = `STAGING_PHOTO_${digest(session.user.id)}`;
    const raw = properties.getProperty(key);
    const record = raw ? recordSchema.parse(JSON.parse(raw)) : null;
    if (record && record.ownerSub !== session.user.id) throw new AuthError('ACCESS_DENIED');
    if (command.action === 'spike.photo.read' && !record) return empty;
    if (command.action === 'spike.photo.delete' && !record) return empty;
    const folderId = properties.getProperty('DRIVE_FOLDER_ID');
    if (!folderId || (record && record.folderId !== folderId))
      throw new PhotoError('PHOTO_UNAVAILABLE');
    const folder = privateFolder(folderId);
    if (command.action === 'spike.photo.upload') {
      const image = Utilities.base64Decode(command.payload.imageBase64);
      const thumbnail = Utilities.base64Decode(command.payload.thumbnailBase64);
      const dimensions = inspectJpeg(image, PHOTO_LIMITS.imageBytes, PHOTO_LIMITS.imageEdge);
      inspectJpeg(thumbnail, PHOTO_LIMITS.thumbnailBytes, PHOTO_LIMITS.thumbnailEdge);
      const imageDigest = digest(image),
        thumbnailDigest = digest(thumbnail);
      if (record) {
        if (
          record.info.id !== command.payload.uploadId ||
          record.imageDigest !== imageDigest ||
          record.thumbnailDigest !== thumbnailDigest
        )
          throw new PhotoError('PHOTO_EXISTS');
        return { photo: record.info, thumbnailBase64: null };
      }
      const id = command.payload.uploadId;
      const created: GoogleAppsScript.Drive.File[] = [];
      let committed = false;
      try {
        const imageFile = folder.createFile(
          Utilities.newBlob(image, 'image/jpeg', fileName(id, 'image')),
        );
        created.push(imageFile);
        const thumbnailFile = folder.createFile(
          Utilities.newBlob(thumbnail, 'image/jpeg', fileName(id, 'thumbnail')),
        );
        created.push(thumbnailFile);
        created.forEach(assertPrivate);
        const info = {
          id,
          ...dimensions,
          bytes: image.length,
          thumbnailBytes: thumbnail.length,
          createdAt: new Date().toISOString(),
        };
        const value = JSON.stringify({
          ownerSub: session.user.id,
          folderId,
          imageId: imageFile.getId(),
          thumbnailId: thumbnailFile.getId(),
          imageDigest,
          thumbnailDigest,
          info,
        });
        // Publish metadata only after both private files exist. Same uploadId can be retried.
        properties.setProperty(key, value);
        committed = true;
        return { photo: info, thumbnailBase64: null };
      } catch (error) {
        // A property write can succeed before its response fails; never trash committed files.
        const saved = properties.getProperty(key);
        if (!committed && !saved) {
          for (const file of created) {
            try {
              file.setTrashed(true);
            } catch {
              /* Orphan repair is documented for staging. */
            }
          }
        }
        throw error;
      }
    }
    if (!record) return empty;
    const deleting = command.action === 'spike.photo.delete';
    if (deleting && command.payload.id !== record.info.id) throw new PhotoError('PHOTO_EXISTS');
    const image = ownedFile(record.imageId, folderId, fileName(record.info.id, 'image'), deleting);
    const thumbnail = ownedFile(
      record.thumbnailId,
      folderId,
      fileName(record.info.id, 'thumbnail'),
      deleting,
    );
    if (deleting) {
      // Retry can finish a partial deletion. Only files referenced by this owner's record are touched.
      image.setTrashed(true);
      thumbnail.setTrashed(true);
      properties.deleteProperty(key);
      return empty;
    }
    if (
      image.getSize() !== record.info.bytes ||
      thumbnail.getSize() !== record.info.thumbnailBytes ||
      image.getMimeType() !== 'image/jpeg' ||
      thumbnail.getMimeType() !== 'image/jpeg'
    )
      throw new PhotoError('PHOTO_INVALID');
    const bytes = thumbnail.getBlob().getBytes();
    inspectJpeg(bytes, PHOTO_LIMITS.thumbnailBytes, PHOTO_LIMITS.thumbnailEdge);
    if (digest(bytes) !== record.thumbnailDigest) throw new PhotoError('PHOTO_INVALID');
    return { photo: record.info, thumbnailBase64: Utilities.base64Encode(bytes) };
  } catch (error) {
    if (error instanceof PhotoError || error instanceof AuthError) throw error;
    throw new PhotoError('PHOTO_UNAVAILABLE');
  } finally {
    lock.releaseLock();
  }
}
