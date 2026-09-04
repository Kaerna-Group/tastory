import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipePhoto } from '@tastory/contracts';
import { ensureRecipePhoto, readRecipePhoto } from './recipe-photos';

const jpeg = [255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 2, 1, 255, 217];
const encoded = Buffer.from(jpeg).toString('base64');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const iterator = <T>(values: T[]) => {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
};

function fixture() {
  const permissions = () => ({
    isTrashed: () => false,
    getSharingAccess: vi.fn(() => 'PRIVATE'),
    getEditors: () => [],
    getViewers: () => [],
    getOwner: () => ({ getEmail: () => 'owner@example.test' }),
  });
  const files: Array<ReturnType<typeof makeFile>> = [];
  function makeFile(blob: { bytes: number[]; name: string }) {
    return {
      ...permissions(),
      bytes: blob.bytes,
      getName: () => blob.name,
      getParents: () => iterator([{ getId: () => 'root' }]),
      getMimeType: () => 'image/jpeg',
      getSize: () => blob.bytes.length,
      getBlob: () => ({ getBytes: () => blob.bytes }),
    };
  }
  const folder = {
    ...permissions(),
    getId: () => 'root',
    getParents: () => iterator([]),
    getFilesByName: (name: string) => iterator(files.filter((file) => file.getName() === name)),
    createFile: vi.fn((blob: { bytes: number[]; name: string }) => {
      const file = makeFile(blob);
      files.push(file);
      return file;
    }),
  };
  vi.stubGlobal('DriveApp', { Access: { PRIVATE: 'PRIVATE' }, getFolderById: () => folder });
  vi.stubGlobal('Session', { getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) });
  vi.stubGlobal('Utilities', {
    base64Decode: (value: string) => [...Buffer.from(value, 'base64')],
    base64Encode: (value: number[]) => Buffer.from(value).toString('base64'),
    newBlob: (bytes: number[], _mime: string, name: string) => ({ bytes, name }),
  });
  const timestamp = '2026-09-03T12:00:00.000Z';
  const photo: RecipePhoto = {
    id: randomUUID(),
    recipeId: randomUUID(),
    kind: 'cover',
    stepId: null,
    position: 0,
    width: 1,
    height: 1,
    bytes: jpeg.length,
    thumbnailBytes: jpeg.length,
    imageDigest: digest(encoded),
    thumbnailDigest: digest(encoded),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  };
  return { files, folder, photo };
}

let state: ReturnType<typeof fixture>;
beforeEach(() => {
  state = fixture();
});
afterEach(() => vi.unstubAllGlobals());

describe('private recipe photos', () => {
  it('stores immutable image variants once and verifies them on every read', () => {
    ensureRecipePhoto(
      'root',
      state.photo,
      { imageBase64: encoded, thumbnailBase64: encoded },
      digest,
    );
    ensureRecipePhoto(
      'root',
      state.photo,
      { imageBase64: encoded, thumbnailBase64: encoded },
      digest,
    );
    expect(state.files).toHaveLength(2);
    expect(readRecipePhoto('root', state.photo, 'thumbnail', digest)).toBe(encoded);
    state.files[0]?.bytes.push(0);
    expect(() => readRecipePhoto('root', state.photo, 'image', digest)).toThrow('PHOTO_INVALID');
  });

  it('rejects changed uploads and non-private roots without replacing files', () => {
    expect(() =>
      ensureRecipePhoto(
        'root',
        { ...state.photo, bytes: jpeg.length + 1 },
        { imageBase64: encoded, thumbnailBase64: encoded },
        digest,
      ),
    ).toThrow('PHOTO_INVALID');
    state.folder.getSharingAccess.mockReturnValue('ANYONE');
    expect(() =>
      ensureRecipePhoto(
        'root',
        state.photo,
        { imageBase64: encoded, thumbnailBase64: encoded },
        digest,
      ),
    ).toThrow('PHOTO_NOT_PRIVATE');
    expect(state.files).toHaveLength(0);
  });
});
