import { afterEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({
  state: { status: 'signed-in', user: { id: 'account-A' } },
  listener: () => {},
  recipes: vi.fn(),
  stickers: vi.fn(),
}));
vi.mock('./session-store', () => ({
  getSession: () => session.state,
  subscribeSession: (listener: () => void) => {
    session.listener = listener;
  },
  requestSessionRecipes: session.recipes,
  requestSessionStickers: session.stickers,
}));
import { acquireRecipePhoto, acquireStickerImage } from './session-resources';
afterEach(() => {
  session.state.status = 'signed-out';
  session.listener();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  session.recipes.mockReset();
  session.stickers.mockReset();
});

it('revokes every object URL on logout, keeps thumbnail reads small and reauthorizes the next account', async () => {
  session.state = { status: 'signed-in', user: { id: 'account-A' } };
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode() {
        return Promise.resolve();
      }
    },
  );
  const revoke = vi.fn();
  const create = vi.fn().mockReturnValueOnce('blob:A').mockReturnValueOnce('blob:B');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  session.recipes.mockResolvedValue({ kind: 'photo', base64: 'aW1hZ2U=' });
  const first = acquireRecipePhoto('recipe-A', { id: 'photo-A' }, 'thumbnail');
  const duplicate = acquireRecipePhoto('recipe-A', { id: 'photo-A' }, 'thumbnail');
  expect(await first.promise).toBe('blob:A');
  await duplicate.promise;
  expect(session.recipes).toHaveBeenCalledTimes(1);
  expect(session.recipes.mock.calls[0]?.[0]).toEqual({
    action: 'recipes.photos.read',
    payload: { recipeId: 'recipe-A', photoId: 'photo-A', variant: 'thumbnail' },
  });
  session.state.status = 'signed-out';
  session.listener();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:A');
  session.state = { status: 'signed-in', user: { id: 'account-B' } };
  session.listener();
  const second = acquireRecipePhoto('recipe-A', { id: 'photo-A' }, 'thumbnail');
  expect(await second.promise).toBe('blob:B');
  expect(session.recipes).toHaveBeenCalledTimes(2);
  first.release();
  duplicate.release();
  second.release();
  expect(revoke).toHaveBeenCalledTimes(2);
});

it('does not reuse a private sticker by digest under another recipe authority', async () => {
  session.state = { status: 'signed-in', user: { id: 'account-A' } };
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:sticker', revokeObjectURL: vi.fn() });
  session.stickers
    .mockResolvedValueOnce({
      kind: 'stickerAsset',
      mimeType: 'image/png',
      base64: 'aW1hZ2U=',
      digest: 'digest',
    })
    .mockRejectedValueOnce(new Error('ACCESS_DENIED'));
  const item = { id: 'sticker', assetKey: null, digest: 'digest' };
  const allowed = acquireStickerImage(item, { recipeId: 'recipe-A', id: 'instance-A' });
  await allowed.promise;
  const denied = acquireStickerImage(item, { recipeId: 'recipe-B', id: 'instance-B' });
  await expect(denied.promise).rejects.toThrow('ACCESS_DENIED');
  expect(session.stickers).toHaveBeenCalledTimes(2);
  allowed.release();
  denied.release();
});
