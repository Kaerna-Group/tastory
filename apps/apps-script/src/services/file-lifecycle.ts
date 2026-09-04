import { recipePhotoSchema } from '@tastory/contracts';
import { stickerItemSchema } from '@tastory/contracts';
import type { RecipeData, RecipePhoto } from '@tastory/contracts';
import { historicalSnapshot } from './recipe-history';
import { readRecipeOperations } from './recipe-storage';
import type { RecipeStore } from './recipe-storage';
import { bytesDigest, fileInFolder, privateResourceFolder } from '../platform/private-resources';
import { readStickerState } from './sticker-storage';
import { stickerAssetName } from '../platform/sticker-assets';

export class FileLifecycleError extends Error {
  constructor(
    public readonly code: 'FILE_UNAVAILABLE' | 'FILE_CONFLICT' | 'FILE_LIMIT' = 'FILE_UNAVAILABLE',
  ) {
    super(code);
  }
}

const TRASH_NAME = 'Tastory — корзина файлов';
const photoName = (photo: RecipePhoto, variant: 'image' | 'thumbnail') =>
  `tastory-recipe-${photo.recipeId}-${photo.id}-${variant}.jpg`;
type Expected = {
  name: string;
  recipeId: string | null;
  bytes: number;
  digest: string;
  digestKind: 'base64' | 'bytes';
  fileId: string | null;
  mime: string;
};
type FileReport = Extract<RecipeData, { kind: 'files' }>;

function list<T>(iterator: { hasNext: () => boolean; next: () => T }, limit = 2000): T[] {
  const result: T[] = [];
  while (iterator.hasNext()) {
    if (result.length >= limit) throw new FileLifecycleError('FILE_LIMIT');
    result.push(iterator.next());
  }
  return result;
}

function trashFolder(root: GoogleAppsScript.Drive.Folder, create: boolean) {
  const folders = list(root.getFoldersByName(TRASH_NAME), 2);
  if (folders.length > 1) throw new FileLifecycleError('FILE_CONFLICT');
  if (!folders.length && !create) return null;
  const folder = folders[0] ?? root.createFolder(TRASH_NAME);
  return privateResourceFolder(folder.getId());
}

function addExpected(target: Map<string, Expected>, expected: Expected) {
  const previous = target.get(expected.name);
  if (previous && JSON.stringify(previous) !== JSON.stringify(expected))
    throw new FileLifecycleError();
  target.set(expected.name, expected);
  if (target.size > 10000) throw new FileLifecycleError('FILE_LIMIT');
}

function expectedFiles(
  store: RecipeStore,
  properties: GoogleAppsScript.Properties.Properties,
  sha256: (value: string) => string,
) {
  const expected = new Map<string, Expected>();
  for (const operation of readRecipeOperations(store)) {
    if (!operation.state.startsWith('committed@') || operation.entityType !== 'recipe') continue;
    const snapshot = historicalSnapshot(store, operation, sha256);
    for (const row of snapshot.RecipePhotos) {
      const photo = recipePhotoSchema.parse(row);
      for (const variant of ['image', 'thumbnail'] as const)
        addExpected(expected, {
          name: photoName(photo, variant),
          recipeId: photo.recipeId,
          bytes: variant === 'image' ? photo.bytes : photo.thumbnailBytes,
          digest: variant === 'image' ? photo.imageDigest : photo.thumbnailDigest,
          digestKind: 'base64',
          fileId: null,
          mime: 'image/jpeg',
        });
    }
  }
  for (const [key, raw] of Object.entries(properties.getProperties())) {
    if (!/^STAGING_PHOTO_[a-f0-9]{64}$/.test(key)) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new FileLifecycleError();
    }
    const info = record['info'] as Record<string, unknown> | undefined;
    const id = info?.['id'];
    for (const variant of ['image', 'thumbnail'] as const) {
      const fileId = record[variant === 'image' ? 'imageId' : 'thumbnailId'];
      const bytes = info?.[variant === 'image' ? 'bytes' : 'thumbnailBytes'];
      const digest = record[variant === 'image' ? 'imageDigest' : 'thumbnailDigest'];
      if (
        typeof id !== 'string' ||
        typeof fileId !== 'string' ||
        typeof bytes !== 'number' ||
        typeof digest !== 'string'
      )
        throw new FileLifecycleError();
      addExpected(expected, {
        name: `tastory-spike-${id}-${variant}.jpg`,
        recipeId: null,
        bytes,
        digest,
        digestKind: 'bytes',
        fileId,
        mime: 'image/jpeg',
      });
    }
  }
  for (const row of readStickerState(store).stickers.values()) {
    const { versionId, ...value } = row;
    void versionId;
    const sticker = stickerItemSchema.parse(value);
    if (sticker.assetKey) continue;
    addExpected(expected, {
      name: stickerAssetName(sticker),
      recipeId: null,
      bytes: sticker.bytes,
      digest: sticker.digest,
      digestKind: 'base64',
      fileId: null,
      mime: sticker.mimeType,
    });
  }
  return expected;
}

function scan(options: {
  folderId: string;
  store: RecipeStore;
  properties: GoogleAppsScript.Properties.Properties;
  sha256: (value: string) => string;
  now: () => Date;
}): FileReport {
  const { folderId, store, properties, sha256, now } = options;
  const root = privateResourceFolder(folderId);
  const expected = expectedFiles(store, properties, sha256);
  const rootFiles = list(root.getFiles()).map((file) => fileInFolder(file, root.getId()));
  const byName = new Map<string, GoogleAppsScript.Drive.File[]>();
  for (const file of rootFiles)
    byName.set(file.getName(), [...(byName.get(file.getName()) ?? []), file]);
  const items: FileReport['items'] = [];
  let healthy = 0;
  for (const reference of expected.values()) {
    const matches = byName.get(reference.name) ?? [];
    if (!matches.length) {
      items.push({
        fileId: null,
        name: reference.name,
        status: 'missing',
        recipeId: reference.recipeId,
      });
      continue;
    }
    const valid =
      matches.length === 1 &&
      (reference.fileId === null || matches[0]?.getId() === reference.fileId) &&
      matches[0]?.getMimeType() === reference.mime &&
      matches[0]?.getSize() === reference.bytes &&
      (reference.digestKind === 'base64'
        ? sha256(Utilities.base64Encode(matches[0].getBlob().getBytes()))
        : bytesDigest(matches[0].getBlob().getBytes())) === reference.digest;
    if (valid) healthy++;
    else
      for (const file of matches)
        items.push({
          fileId: file.getId(),
          name: file.getName(),
          status: 'damaged',
          recipeId: reference.recipeId,
        });
  }
  const assetPattern =
    /^(?:tastory-(?:recipe-[0-9a-f-]{36}-[0-9a-f-]{36}|spike-[0-9a-f-]{36})-(?:image|thumbnail)\.jpg|tastory-sticker-[0-9a-f-]{36}\.(?:png|webp))$/;
  const historyPattern = /^tastory-history-[a-f0-9]{64}\.json$/;
  for (const file of rootFiles) {
    if (expected.has(file.getName()) || historyPattern.test(file.getName())) continue;
    items.push({
      fileId: file.getId(),
      name: file.getName(),
      status: assetPattern.test(file.getName()) ? 'orphaned' : 'unknown',
      recipeId: null,
    });
  }
  const trash = trashFolder(root, false);
  if (trash)
    for (const file of list(trash.getFiles()).map((entry) => fileInFolder(entry, trash.getId())))
      items.push({ fileId: file.getId(), name: file.getName(), status: 'trashed', recipeId: null });
  if (items.length > 2000) throw new FileLifecycleError('FILE_LIMIT');
  const count = (status: FileReport['items'][number]['status']) =>
    items.filter((item) => item.status === status).length;
  return {
    kind: 'files',
    checkedAt: now().toISOString(),
    summary: {
      healthy,
      missing: count('missing'),
      damaged: count('damaged'),
      orphaned: count('orphaned'),
      unknown: count('unknown'),
      trashed: count('trashed'),
    },
    items: items.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name)),
  };
}

export function manageFiles(
  options: {
    folderId: string;
    store: RecipeStore;
    properties: GoogleAppsScript.Properties.Properties;
    sha256: (value: string) => string;
    now: () => Date;
    assertAuthorized: () => void;
  },
  command:
    | { action: 'admin.files.audit'; payload: Record<string, never> }
    | { action: 'admin.files.trash'; payload: { fileId: string } }
    | { action: 'admin.files.trashUnused'; payload: Record<string, never> }
    | { action: 'admin.files.restore'; payload: { fileId: string } }
    | { action: 'admin.files.cleanup'; payload: Record<string, never> },
): FileReport {
  try {
    options.assertAuthorized();
    const root = privateResourceFolder(options.folderId);
    if (command.action === 'admin.files.trash') {
      const report = scan(options);
      const item = report.items.find(
        (entry) => entry.fileId === command.payload.fileId && entry.status === 'orphaned',
      );
      if (!item) {
        if (
          report.items.some(
            (entry) => entry.fileId === command.payload.fileId && entry.status === 'trashed',
          )
        ) {
          options.assertAuthorized();
          return report;
        }
        throw new FileLifecycleError('FILE_CONFLICT');
      }
      const file = fileInFolder(DriveApp.getFileById(command.payload.fileId), root.getId());
      options.assertAuthorized();
      file.moveTo(trashFolder(root, true) as GoogleAppsScript.Drive.Folder);
    } else if (command.action === 'admin.files.trashUnused') {
      const report = scan(options);
      const orphanIds = report.items.flatMap((entry) =>
        entry.status === 'orphaned' && entry.fileId ? [entry.fileId] : [],
      );
      const trash = orphanIds.length ? trashFolder(root, true) : null;
      for (const fileId of orphanIds) {
        const file = fileInFolder(DriveApp.getFileById(fileId), root.getId());
        options.assertAuthorized();
        file.moveTo(trash as GoogleAppsScript.Drive.Folder);
      }
    } else if (command.action === 'admin.files.restore') {
      const report = scan(options);
      if (
        report.items.some(
          (entry) => entry.fileId === command.payload.fileId && entry.status === 'orphaned',
        )
      ) {
        options.assertAuthorized();
        return report;
      }
      const trash = trashFolder(root, false);
      if (!trash) throw new FileLifecycleError('FILE_CONFLICT');
      const file = fileInFolder(DriveApp.getFileById(command.payload.fileId), trash.getId());
      if (root.getFilesByName(file.getName()).hasNext())
        throw new FileLifecycleError('FILE_CONFLICT');
      options.assertAuthorized();
      file.moveTo(root);
    } else if (command.action === 'admin.files.cleanup') {
      const trash = trashFolder(root, false);
      if (trash)
        for (const file of list(trash.getFiles()).map((entry) =>
          fileInFolder(entry, trash.getId()),
        )) {
          options.assertAuthorized();
          file.setTrashed(true);
        }
    }
    options.assertAuthorized();
    return scan(options);
  } catch (error) {
    if (error instanceof FileLifecycleError) throw error;
    throw new FileLifecycleError();
  }
}
