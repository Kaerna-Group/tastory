import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privatePhoto } from './private-photo';
import { inspectJpeg } from '../services/jpeg';
import { handleRequest } from '../controllers/handle-request';
import type { AuthData, PhotoCommand } from '@tastory/contracts';

const id = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
// Minimal JPEG header fixture for dimension/size checks; browser E2E uses a real canvas JPEG.
const jpeg = [255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 2, 1, 255, 217];
const encoded = Buffer.from(jpeg).toString('base64');
const upload: PhotoCommand = {
  action: 'spike.photo.upload',
  payload: { uploadId: id, imageBase64: encoded, thumbnailBase64: encoded },
};
const read: PhotoCommand = { action: 'spike.photo.read', payload: {} };
const remove: PhotoCommand = { action: 'spike.photo.delete', payload: { id } };
const owner: AuthData = {
  user: { id: 'google-sub', role: 'owner', email: 'chef@gmail.com', name: 'Chef' },
  expiresAt: '2099-01-01T00:00:00Z',
};
const iterator = <T>(values: T[]) => {
  let i = 0;
  return { hasNext: () => i < values.length, next: () => values[i++] };
};
function fixture() {
  const properties: Record<string, string> = {
    APP_ENV: 'staging',
    DRIVE_FOLDER_ID: 'private-folder',
  };
  const propertyApi = {
    getProperty: (key: string) => properties[key] ?? null,
    setProperty: vi.fn((key: string, value: string) => {
      properties[key] = value;
    }),
    deleteProperty: (key: string) => {
      delete properties[key];
    },
  };
  const permissions = () => ({
    getSharingAccess: vi.fn(() => 'PRIVATE'),
    getEditors: vi.fn((): string[] => []),
    getViewers: vi.fn((): string[] => []),
    getOwner: () => ({ getEmail: () => 'chef@gmail.com' }),
  });
  function makeFile(blob: { bytes: number[]; name: string }) {
    const file = {
      ...permissions(),
      getId: () => blob.name,
      getName: () => blob.name,
      isTrashed: () => file.trashed,
      trashed: false,
      setTrashed: vi.fn((value: boolean) => {
        file.trashed = value;
      }),
      getParents: () => iterator([{ getId: () => 'private-folder' }]),
      getSize: () => blob.bytes.length,
      getMimeType: () => 'image/jpeg',
      getBlob: () => ({ getBytes: () => blob.bytes }),
    };
    return file;
  }
  const files: ReturnType<typeof makeFile>[] = [];
  const folder = {
    ...permissions(),
    getId: () => 'private-folder',
    isTrashed: () => false,
    getParents: () => iterator([]),
    createFile: vi.fn((blob: { bytes: number[]; name: string }) => {
      const file = makeFile(blob);
      files.push(file);
      return file;
    }),
  };
  const lock = { tryLock: vi.fn(() => true), releaseLock: vi.fn() };
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => propertyApi });
  vi.stubGlobal('Session', { getEffectiveUser: () => ({ getEmail: () => 'chef@gmail.com' }) });
  vi.stubGlobal('LockService', { getScriptLock: () => lock });
  vi.stubGlobal('DriveApp', {
    Access: { PRIVATE: 'PRIVATE' },
    getFolderById: () => folder,
    getFileById: (fileId: string) =>
      files.find((file) => file.getId() === fileId && !file.trashed) ??
      files.find((file) => file.getId() === fileId),
  });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF-8' },
    computeDigest: (_: string, value: string | number[]) => [
      ...createHash('sha256')
        .update(typeof value === 'string' ? value : Buffer.from(value))
        .digest(),
    ],
    base64Decode: (value: string) => [...Buffer.from(value, 'base64')],
    base64Encode: (value: number[]) => Buffer.from(value).toString('base64'),
    newBlob: (bytes: number[], _mime: string, name: string) => ({ bytes, name }),
  });
  return { properties, propertyApi, folder, files, lock };
}
let state: ReturnType<typeof fixture>;
beforeEach(() => {
  state = fixture();
});
afterEach(() => vi.unstubAllGlobals());
describe('private staging photos', () => {
  it('stores private files once, reads only thumbnail and deletes only the owner record', () => {
    expect(privatePhoto(read, owner).photo).toBeNull();
    expect(privatePhoto(upload, owner).photo).toMatchObject({
      id,
      width: 1,
      height: 1,
      bytes: jpeg.length,
    });
    expect(privatePhoto(upload, owner).photo?.id).toBe(id);
    expect(state.files).toHaveLength(2);
    const response = privatePhoto(read, owner);
    expect(response.thumbnailBase64).toBe(encoded);
    expect(JSON.stringify(response)).not.toContain('private-folder');
    expect(
      privatePhoto(read, { ...owner, user: { ...owner.user, id: 'other-owner' } }).photo,
    ).toBeNull();
    privatePhoto(remove, { ...owner, user: { ...owner.user, id: 'other-owner' } });
    expect(state.files.some((file) => file.trashed)).toBe(false);
    privatePhoto(remove, owner);
    expect(state.files.every((file) => file.trashed)).toBe(true);
    expect(privatePhoto(remove, owner).photo).toBeNull();
    expect(state.lock.releaseLock).toHaveBeenCalledTimes(8);
  });
  it('rejects non-owner, expired sessions and production without file writes', () => {
    expect(() =>
      privatePhoto(upload, { ...owner, user: { ...owner.user, role: 'viewer' } }),
    ).toThrow('ACCESS_DENIED');
    expect(() => privatePhoto(upload, { ...owner, expiresAt: '2020-01-01T00:00:00Z' })).toThrow(
      'UNAUTHENTICATED',
    );
    state.properties['APP_ENV'] = 'production';
    expect(() => privatePhoto(upload, owner)).toThrow('PHOTO_UNAVAILABLE');
    expect(state.files).toHaveLength(0);
  });
  it('rejects sharing through links, explicit viewers and changed file permissions', () => {
    state.folder.getSharingAccess.mockReturnValue('ANYONE_WITH_LINK');
    expect(() => privatePhoto(upload, owner)).toThrow('PHOTO_NOT_PRIVATE');
    state.folder.getSharingAccess.mockReturnValue('PRIVATE');
    state.folder.getViewers.mockReturnValue(['someone']);
    expect(() => privatePhoto(upload, owner)).toThrow('PHOTO_NOT_PRIVATE');
    state.folder.getViewers.mockReturnValue([]);
    privatePhoto(upload, owner);
    state.files[1]?.getSharingAccess.mockReturnValue('ANYONE');
    expect(() => privatePhoto(read, owner)).toThrow('PHOTO_NOT_PRIVATE');
  });
  it('prevents overwrites and stale deletion; preserves the first upload', () => {
    privatePhoto(upload, owner);
    const another = 'a3dcd2e8-e2f8-428b-9e26-3e715f678fac';
    if (upload.action !== 'spike.photo.upload') throw new Error();
    expect(() =>
      privatePhoto({ ...upload, payload: { ...upload.payload, uploadId: another } }, owner),
    ).toThrow('PHOTO_EXISTS');
    expect(() =>
      privatePhoto({ action: 'spike.photo.delete', payload: { id: another } }, owner),
    ).toThrow('PHOTO_EXISTS');
    expect(state.files.some((file) => file.trashed)).toBe(false);
  });
  it('cleans up partial uploads and keeps committed files after an ambiguous write response', () => {
    state.propertyApi.setProperty.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(() => privatePhoto(upload, owner)).toThrow('PHOTO_UNAVAILABLE');
    expect(state.files.every((file) => file.trashed)).toBe(true);
    state.propertyApi.setProperty.mockImplementationOnce((key, value) => {
      state.properties[key] = value;
      throw new Error('response lost');
    });
    expect(() => privatePhoto(upload, owner)).toThrow('PHOTO_UNAVAILABLE');
    expect(state.files.slice(2).every((file) => !file.trashed)).toBe(true);
    expect(privatePhoto(upload, owner).photo?.id).toBe(id);
    expect(state.files).toHaveLength(4);
  });
  it('releases locks on invalid input and refuses lock contention', () => {
    if (upload.action !== 'spike.photo.upload') throw new Error();
    expect(() =>
      privatePhoto({ ...upload, payload: { ...upload.payload, imageBase64: 'AAAA' } }, owner),
    ).toThrow('PHOTO_INVALID');
    expect(state.lock.releaseLock).toHaveBeenCalledOnce();
    state.lock.tryLock.mockReturnValue(false);
    expect(() => privatePhoto(upload, owner)).toThrow('PHOTO_UNAVAILABLE');
    expect(state.files).toHaveLength(0);
  });
  it('finishes a deletion after one of the two trash operations fails', () => {
    privatePhoto(upload, owner);
    state.files[1]?.setTrashed.mockImplementationOnce(() => {
      throw new Error('Drive timeout');
    });
    expect(() => privatePhoto(remove, owner)).toThrow('PHOTO_UNAVAILABLE');
    expect(state.files[0]?.trashed).toBe(true);
    expect(state.files[1]?.trashed).toBe(false);
    expect(privatePhoto(remove, owner).photo).toBeNull();
    expect(state.files.every((file) => file.trashed)).toBe(true);
  });
  it('validates JPEG dimensions and byte limits, not file names or MIME declarations', () => {
    expect(
      inspectJpeg(
        jpeg.map((b) => (b > 127 ? b - 256 : b)),
        1024,
        320,
      ),
    ).toEqual({ width: 1, height: 1 });
    const oversized = [...jpeg];
    oversized[9] = 255;
    for (const bytes of [
      [1, 2, 3],
      jpeg.slice(0, -2),
      oversized,
      [...jpeg.slice(0, 2), ...jpeg.slice(15)],
    ])
      expect(() => inspectJpeg(bytes, 1024, 320)).toThrow('PHOTO_INVALID');
    expect(() => inspectJpeg(jpeg, 10, 320)).toThrow('PHOTO_INVALID');
  });
  it('authenticates every photo route without joining and rejects arbitrary file IDs', () => {
    const authenticate = vi.fn(() => owner),
      photo = vi.fn(privatePhoto);
    const context = {
      now: () => new Date(),
      createRequestId: () => id,
      isEchoEnabled: false,
      deploymentVersion: 'test',
      authenticate,
      photo,
    };
    const request = { apiVersion: 1, requestId: id, credential: 'synthetic', ...read };
    expect(handleRequest(request, context)).toMatchObject({ ok: true, data: { photo: null } });
    expect(authenticate).toHaveBeenCalledWith('synthetic', false);
    expect(handleRequest({ ...request, credential: undefined }, context)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(
      handleRequest({ ...request, payload: { fileId: 'someone-elses-drive-file' } }, context),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    authenticate.mockReturnValue({ ...owner, user: { ...owner.user, role: 'member' } });
    expect(handleRequest(request, context)).toMatchObject({ error: { code: 'ACCESS_DENIED' } });
    expect(photo).toHaveBeenCalledOnce();
    authenticate.mockReturnValue(owner);
    expect(
      handleRequest(request, {
        now: context.now,
        createRequestId: context.createRequestId,
        isEchoEnabled: false,
        deploymentVersion: 'test',
        authenticate,
      }),
    ).toMatchObject({
      error: { code: 'PHOTO_UNAVAILABLE' },
    });
  });
});
