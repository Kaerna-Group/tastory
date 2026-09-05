import { BUILTIN_STICKER_ASSET_PATHS } from '@tastory/contracts';
import type { RecipePhoto, RecipeSticker, StickerItem } from '@tastory/contracts';
import {
  getSession,
  subscribeSession,
  requestSessionRecipes,
  requestSessionStickers,
} from './session-store';
import { ResourcePool } from './resource-pool';

const resources = new ResourcePool();
subscribeSession(() => {
  // signIn resets the session first, including when switching accounts or rechecking access.
  if (getSession().status !== 'signed-in') resources.clear();
});

async function decoded(source: string, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    const image = new Image();
    image.src = source;
    await image.decode();
    signal.throwIfAborted();
    return source;
  } catch (error) {
    if (source.startsWith('blob:')) URL.revokeObjectURL(source);
    throw error;
  }
}
function release(source: string) {
  if (source.startsWith('blob:')) URL.revokeObjectURL(source);
}
function objectUrl(base64: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
function scope() {
  const session = getSession();
  if (session.status !== 'signed-in' || !session.user) throw new Error('Войдите в Google.');
  return session.user.id;
}

export function acquireRecipePhoto(
  recipeId: string,
  photo: Pick<RecipePhoto, 'id'> & Partial<Pick<RecipePhoto, 'imageDigest' | 'thumbnailDigest'>>,
  variant: 'image' | 'thumbnail',
) {
  return resources.acquire(
    JSON.stringify([
      scope(),
      'photo',
      recipeId,
      photo.id,
      variant,
      variant === 'image' ? photo.imageDigest : photo.thumbnailDigest,
    ]),
    async (signal) => {
      const result = await requestSessionRecipes(
        { action: 'recipes.photos.read', payload: { recipeId, photoId: photo.id, variant } },
        crypto.randomUUID(),
        signal,
      );
      if (result.kind !== 'photo') throw new Error('Сервер не вернул фотографию.');
      return decoded(objectUrl(result.base64, 'image/jpeg'), signal);
    },
    release,
  );
}

export function acquireRecipeStickers(recipeId: string, refreshKey: string | number) {
  return resources.acquire(
    JSON.stringify([scope(), 'placements', recipeId, refreshKey]),
    async (signal) => {
      const result = await requestSessionStickers(
        { action: 'recipes.stickers.list', payload: { recipeId } },
        crypto.randomUUID(),
        signal,
      );
      if (result.kind !== 'recipeStickers') throw new Error('Сервер не вернул стикеры рецепта.');
      return result.stickers.filter((item) => item.status === 'active');
    },
  );
}

export function acquireStickerImage(
  item: Pick<StickerItem, 'id' | 'assetKey' | 'digest'>,
  placement?: Pick<RecipeSticker, 'recipeId' | 'id'>,
) {
  const payload = placement
    ? { recipeId: placement.recipeId, instanceId: placement.id }
    : { stickerId: item.id };
  // Asset digest alone is not authority: different recipes/placements never share a protected read.
  return resources.acquire(
    JSON.stringify([scope(), 'sticker', payload, item.digest, item.assetKey]),
    async (signal) => {
      if (item.assetKey)
        return decoded(
          `${import.meta.env.BASE_URL}${BUILTIN_STICKER_ASSET_PATHS[item.assetKey]}`,
          signal,
        );
      const result = await requestSessionStickers(
        { action: 'stickers.assets.read', payload },
        crypto.randomUUID(),
        signal,
      );
      if (result.kind !== 'stickerAsset' || result.digest !== item.digest)
        throw new Error('Файл стикера недоступен или изменился.');
      return decoded(objectUrl(result.base64, result.mimeType), signal);
    },
    release,
  );
}
