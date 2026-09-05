import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { RecipePageRenderer } from '@/entities/recipe-page';
import type {
  RecipePageLayoutStatus,
  RecipePageRendererProps,
  RecipePageSticker,
  RecipePagePhoto,
} from '@/entities/recipe-page';
import { acquireRecipePhoto, acquireRecipeStickers, acquireStickerImage } from '@/entities/session';
import type { RecipePhoto, Tag } from '../model/drafts';
import type { RecipeSticker } from '../model/stickers';
import { themeCssVariables } from '@/shared/theme';
import type { RecipeTheme } from '../model/templates';

export type RecipePageAssetsStatus = 'loading' | 'ready' | 'error';
type RecipePagePreviewProps = Omit<
  RecipePageRendererProps,
  | 'coverImageSource'
  | 'tagNames'
  | 'stickers'
  | 'measurementKey'
  | 'onLayoutStatusChange'
  | 'photos'
> & {
  tags: readonly Tag[];
  coverPhoto: RecipePhoto | null;
  photos?: readonly RecipePhoto[];
  theme: RecipeTheme;
  assetRefreshKey?: number;
  onAssetsStatusChange?: (status: RecipePageAssetsStatus) => void;
  onLayoutStatusChange?: (status: RecipePageLayoutStatus) => void;
  stickerGeometry?: readonly Pick<
    RecipeSticker,
    'id' | 'page' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'zIndex'
  >[];
  onStickerPlacementsChange?: (placements: readonly RecipeSticker[]) => void;
};
const EMPTY_PHOTOS: readonly RecipePhoto[] = [];
const EMPTY_RENDER_PHOTOS: readonly RecipePagePhoto[] = [];
const EMPTY_STICKERS: readonly RecipePageSticker[] = [];
type Loaded = {
  key: string;
  cover: string;
  stickers: RecipePageSticker[];
  photos: RecipePagePhoto[];
  errors: string[];
};

export function RecipePagePreview({
  tags,
  coverPhoto,
  photos = EMPTY_PHOTOS,
  theme,
  assetRefreshKey = 0,
  onAssetsStatusChange,
  onLayoutStatusChange,
  stickerGeometry,
  onStickerPlacementsChange,
  ...rendererProps
}: RecipePagePreviewProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const onStickerPlacementsChangeRef = useRef(onStickerPlacementsChange);
  useEffect(() => {
    onStickerPlacementsChangeRef.current = onStickerPlacementsChange;
  }, [onStickerPlacementsChange]);
  const photoInputJson = JSON.stringify(
    coverPhoto && !photos.some((photo) => photo.id === coverPhoto.id)
      ? [coverPhoto, ...photos]
      : photos,
  );
  // Aggregate refreshes may clone identical metadata. Keep leases stable until data really changes.
  const photoInputs = useMemo(() => JSON.parse(photoInputJson) as RecipePhoto[], [photoInputJson]);
  const key = JSON.stringify([rendererProps.recipeId, assetRefreshKey, attempt, photoInputJson]);
  useEffect(() => {
    let cancelled = false;
    const leases: { release: () => void }[] = [];
    const result: Loaded = { key, cover: '', stickers: [], photos: [], errors: [] };
    const keep = <T,>(lease: { release: () => void; promise: Promise<T> }) => {
      leases.push(lease);
      return lease.promise;
    };
    const load = async () => {
      await Promise.all([
        ...photoInputs.map(async (photo) => {
          try {
            const source = await keep(acquireRecipePhoto(rendererProps.recipeId, photo, 'image'));
            if (photo.kind === 'cover') result.cover = source;
            else
              result.photos.push({
                id: photo.id,
                kind: photo.kind,
                stepId: photo.stepId,
                position: photo.position,
                source,
              });
          } catch {
            result.errors.push(
              photo.kind === 'cover'
                ? 'Не удалось открыть обложку.'
                : 'Не удалось открыть фото шага или галереи.',
            );
          }
        }),
        (async () => {
          try {
            const placements = await keep(
              acquireRecipeStickers(rendererProps.recipeId, `${assetRefreshKey}:${attempt}`),
            );
            if (cancelled) return;
            onStickerPlacementsChangeRef.current?.(placements);
            await Promise.all(
              placements.map(async (sticker) => {
                try {
                  const source = await keep(
                    acquireStickerImage(
                      {
                        id: sticker.stickerId,
                        assetKey: sticker.assetKey,
                        digest: sticker.assetDigest,
                      },
                      { recipeId: rendererProps.recipeId, id: sticker.id },
                    ),
                  );
                  result.stickers.push({ ...sticker, pageId: 'page-' + sticker.page, source });
                } catch {
                  result.errors.push('Не удалось открыть стикер «' + sticker.name + '».');
                }
              }),
            );
            result.stickers.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
          } catch {
            result.errors.push('Нет доступа к размещениям стикеров или сервер недоступен.');
          }
        })(),
      ]);
      result.photos.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      if (!cancelled) setLoaded(result);
    };
    void load();
    return () => {
      cancelled = true;
      leases.forEach((lease) => lease.release());
    };
  }, [key, photoInputs, rendererProps.recipeId, assetRefreshKey, attempt]);

  const current = loaded?.key === key ? loaded : null;
  const renderStickers = useMemo(
    () =>
      (current?.stickers ?? EMPTY_STICKERS).map((sticker) => {
        const geometry = stickerGeometry?.find((item) => item.id === sticker.id);
        return geometry ? { ...sticker, ...geometry, pageId: `page-${geometry.page}` } : sticker;
      }),
    [current?.stickers, stickerGeometry],
  );
  const status: RecipePageAssetsStatus = !current
    ? 'loading'
    : current.errors.length
      ? 'error'
      : 'ready';
  const tagNames = useMemo(
    () =>
      rendererProps.value.tagIds
        .map((id) => tags.find((tag) => tag.id === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [rendererProps.value.tagIds, tags],
  );
  useLayoutEffect(() => onAssetsStatusChange?.(status), [status, onAssetsStatusChange]);
  return (
    <div
      className="recipe-page-preview recipe-presentation-theme"
      data-assets-status={status}
      data-paper={theme.paper}
      data-mode={theme.mode}
      style={{ ...themeCssVariables(theme), colorScheme: theme.mode } as CSSProperties}
    >
      {status === 'loading' && <p role="status">Загружаем фотографии и декор…</p>}
      {current && current.errors.length > 0 && (
        <div className="recipe-notice" role="alert">
          <p>Оформление загружено не полностью. {current.errors.join(' ')}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Повторить загрузку изображений
          </button>
        </div>
      )}
      <RecipePageRenderer
        {...rendererProps}
        {...(current?.stickers.length ? { pageView: 'a4' as const } : {})}
        tagNames={tagNames}
        coverImageSource={current?.cover ?? ''}
        stickers={renderStickers}
        photos={current?.photos ?? EMPTY_RENDER_PHOTOS}
        measurementKey={theme.fontPair}
        {...(onLayoutStatusChange ? { onLayoutStatusChange } : {})}
      />
    </div>
  );
}
