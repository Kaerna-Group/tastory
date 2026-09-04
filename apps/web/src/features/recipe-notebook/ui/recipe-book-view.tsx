import { useEffect, useMemo, useState } from 'react';
import { RecipePageRenderer } from '@/entities/recipe-page';
import { requestSessionRecipes, requestSessionTemplates } from '@/entities/session';
import type { RecipeDraftValue, RecipePhoto, Tag } from '../model/drafts';
import type { RecipeTemplate } from '../model/templates';

export function RecipeBookView({
  recipeId,
  recipeRevision,
  value,
  tags,
  coverPhoto,
}: {
  recipeId: string;
  recipeRevision: number;
  value: RecipeDraftValue;
  tags: readonly Tag[];
  coverPhoto: RecipePhoto | null;
}) {
  const [applied, setApplied] = useState<RecipeTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [loadedCover, setLoadedCover] = useState<{
    key: string;
    source: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void requestSessionTemplates(
      { action: 'recipes.template.get', payload: { recipeId } },
      crypto.randomUUID(),
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted || result.kind !== 'recipeTemplate') return;
        setApplied(result.template);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFallback(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [recipeId]);
  useEffect(() => {
    if (!coverPhoto) return;
    const coverKey = `${coverPhoto.id}:${coverPhoto.imageDigest}`;
    const controller = new AbortController();
    void requestSessionRecipes(
      {
        action: 'recipes.photos.read',
        payload: { recipeId, photoId: coverPhoto.id, variant: 'image' },
      },
      crypto.randomUUID(),
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted && result.kind === 'photo')
          setLoadedCover({ key: coverKey, source: `data:image/jpeg;base64,${result.base64}` });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [coverPhoto, recipeId]);
  const coverKey = coverPhoto ? `${coverPhoto.id}:${coverPhoto.imageDigest}` : '';
  const coverImageSource = loadedCover?.key === coverKey ? loadedCover.source : '';
  const tagNames = useMemo(
    () =>
      value.tagIds
        .map((tagId) => tags.find((tag) => tag.id === tagId)?.name)
        .filter((name): name is string => Boolean(name)),
    [tags, value.tagIds],
  );
  const layout = applied?.layout ?? 'hearth';
  const templateName = applied?.templateName ?? 'Домашняя страница';
  return (
    <section className="recipe-book-view" aria-labelledby="recipe-book-title">
      <header className="recipe-book-actions">
        <div>
          <p className="eyebrow">Готовая страница</p>
          <h2 id="recipe-book-title">{templateName}</h2>
          <p className="muted">
            Содержание связано с рецептом, а выбранная композиция сохраняется отдельно.
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => window.print()}>
          Печать / PDF
        </button>
      </header>
      {loading && <p role="status">Открываем оформление…</p>}
      {fallback && (
        <p className="recipe-notice" role="status">
          Оформление сейчас недоступно. Показан безопасный стандартный макет.
        </p>
      )}
      <RecipePageRenderer
        recipeId={recipeId}
        recipeRevision={recipeRevision}
        templateId={applied?.templateId ?? null}
        templateRevision={applied?.revision ?? 1}
        templateName={templateName}
        layout={layout}
        tagNames={tagNames}
        value={value}
        coverImageSource={coverImageSource}
      />
    </section>
  );
}
