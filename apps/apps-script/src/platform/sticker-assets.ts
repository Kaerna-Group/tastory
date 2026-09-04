import { STICKER_LIMITS } from '@tastory/contracts';
import type { StickerItem, StickerUpload } from '@tastory/contracts';
import { StickerStorageError } from '../services/sticker-storage';
import { fileInFolder, privateResourceFolder } from './private-resources';

const extension = (mime: StickerItem['mimeType']) => (mime === 'image/png' ? 'png' : 'webp');
export const stickerAssetName = (sticker: Pick<StickerItem, 'id' | 'mimeType'>) =>
  `tastory-sticker-${sticker.id}.${extension(sticker.mimeType)}`;

function u32be(bytes: number[], offset: number) {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}
function u16le(bytes: number[], offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}
function u24le(bytes: number[], offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}
function ascii(bytes: number[], offset: number, length: number) {
  return bytes
    .slice(offset, offset + length)
    .map((value) => String.fromCharCode(value & 255))
    .join('');
}

export function inspectStickerImage(bytes: number[], mimeType: StickerItem['mimeType']) {
  if (!bytes.length || bytes.length > STICKER_LIMITS.imageBytes)
    throw new StickerStorageError('STICKER_INVALID');
  let dimensions: { width: number; height: number };
  if (mimeType === 'image/png') {
    if (
      bytes.length < 33 ||
      bytes
        .slice(0, 8)
        .map((value) => value & 255)
        .join(',') !== '137,80,78,71,13,10,26,10' ||
      ascii(bytes, 12, 4) !== 'IHDR'
    )
      throw new StickerStorageError('STICKER_INVALID');
    dimensions = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  } else {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP')
      throw new StickerStorageError('STICKER_INVALID');
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') {
      if (((bytes[20] ?? 0) & 2) !== 0) throw new StickerStorageError('STICKER_INVALID');
      dimensions = { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    } else if (chunk === 'VP8L' && (bytes[20] ?? 0) === 47) {
      const bits =
        ((bytes[21] ?? 0) |
          ((bytes[22] ?? 0) << 8) |
          ((bytes[23] ?? 0) << 16) |
          ((bytes[24] ?? 0) << 24)) >>>
        0;
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (chunk === 'VP8 ' && bytes.length >= 30) {
      dimensions = { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    } else throw new StickerStorageError('STICKER_INVALID');
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > STICKER_LIMITS.imageEdge ||
    dimensions.height > STICKER_LIMITS.imageEdge
  )
    throw new StickerStorageError('STICKER_INVALID');
  return dimensions;
}

function oneFile(folder: GoogleAppsScript.Drive.Folder, name: string) {
  const files = folder.getFilesByName(name);
  if (!files.hasNext()) return null;
  const file = fileInFolder(files.next(), folder.getId());
  if (files.hasNext()) throw new StickerStorageError('STICKER_INVALID');
  return file;
}

function checked(
  file: GoogleAppsScript.Drive.File,
  sticker: StickerItem,
  sha256: (value: string) => string,
) {
  if (file.getMimeType() !== sticker.mimeType || file.getSize() !== sticker.bytes)
    throw new StickerStorageError('STICKER_INVALID');
  const bytes = file.getBlob().getBytes();
  const dimensions = inspectStickerImage(bytes, sticker.mimeType);
  const base64 = Utilities.base64Encode(bytes);
  if (
    dimensions.width !== sticker.width ||
    dimensions.height !== sticker.height ||
    sha256(base64) !== sticker.digest
  )
    throw new StickerStorageError('STICKER_INVALID');
  return base64;
}

export function ensureStickerAsset(
  folderId: string,
  sticker: StickerItem,
  upload: StickerUpload,
  sha256: (value: string) => string,
) {
  try {
    const folder = privateResourceFolder(folderId);
    const bytes = Utilities.base64Decode(upload.base64);
    const dimensions = inspectStickerImage(bytes, upload.mimeType);
    if (
      upload.bytes !== bytes.length ||
      upload.mimeType !== sticker.mimeType ||
      dimensions.width !== upload.width ||
      dimensions.height !== upload.height ||
      sticker.width !== upload.width ||
      sticker.height !== upload.height ||
      sticker.bytes !== upload.bytes ||
      sticker.digest !== sha256(upload.base64)
    )
      throw new StickerStorageError('STICKER_INVALID');
    const name = stickerAssetName(sticker);
    const existing = oneFile(folder, name);
    if (existing) return checked(existing, sticker, sha256);
    const file = fileInFolder(
      folder.createFile(Utilities.newBlob(bytes, sticker.mimeType, name)),
      folderId,
    );
    return checked(file, sticker, sha256);
  } catch (error) {
    if (error instanceof StickerStorageError) throw error;
    throw new StickerStorageError();
  }
}

export function readStickerAsset(
  folderId: string,
  sticker: StickerItem,
  sha256: (value: string) => string,
) {
  try {
    if (sticker.assetKey) throw new StickerStorageError('STICKER_INVALID');
    const folder = privateResourceFolder(folderId);
    const file = oneFile(folder, stickerAssetName(sticker));
    if (!file) throw new StickerStorageError();
    return checked(file, sticker, sha256);
  } catch (error) {
    if (error instanceof StickerStorageError) throw error;
    throw new StickerStorageError();
  }
}
