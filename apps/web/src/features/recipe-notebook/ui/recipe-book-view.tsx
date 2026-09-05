import { useEffect, useRef, useState } from 'react';
import type { RecipePageLayoutStatus } from '@/entities/recipe-page';
import { requestSessionTemplates } from '@/entities/session';
import type { RecipeDraftValue, RecipePhoto, Tag } from '../model/drafts';
import { DEFAULT_RECIPE_THEME } from '../model/templates';
import type { RecipeDesign, RecipeTemplate } from '../model/templates';
import { RecipePagePreview } from './recipe-page-preview';
import type { RecipePageAssetsStatus } from './recipe-page-preview';

export function RecipeBookView({
  recipeId,
  recipeRevision,
  value,
  tags,
  coverPhoto,
  photos,
  hasUnsavedContent = false,
  assetRefreshKey = 0,
}: {
  recipeId: string;
  recipeRevision: number;
  value: RecipeDraftValue;
  tags: readonly Tag[];
  coverPhoto: RecipePhoto | null;
  photos: readonly RecipePhoto[];
  hasUnsavedContent?: boolean;
  assetRefreshKey?: number;
}) {
  const root = useRef<HTMLElement>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${recipeId}:${attempt}`;
  const [response, setResponse] = useState<{
    key: string;
    applied: RecipeTemplate | null;
    design: RecipeDesign | null;
    error: boolean;
  } | null>(null);
  const current = response?.key === requestKey ? response : null;
  const loading = !current;
  const applied = current?.applied ?? null;
  const design = current?.design ?? null;
  const [layoutStatus, setLayoutStatus] = useState<RecipePageLayoutStatus>('measuring');
  const [assetsStatus, setAssetsStatus] = useState<RecipePageAssetsStatus>('loading');
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      requestSessionTemplates(
        { action: 'recipes.template.get', payload: { recipeId } },
        crypto.randomUUID(),
        controller.signal,
      ),
      requestSessionTemplates(
        { action: 'recipes.design.get', payload: { recipeId } },
        crypto.randomUUID(),
        controller.signal,
      ),
    ])
      .then(([templateResult, designResult]) => {
        if (controller.signal.aborted) return;
        if (templateResult.kind !== 'recipeTemplate' || designResult.kind !== 'recipeDesign')
          throw new Error('Оформление не получено.');
        setResponse({
          key: requestKey,
          applied: templateResult.template,
          design: designResult.design,
          error: false,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, applied: null, design: null, error: true });
      });
    return () => controller.abort();
  }, [recipeId, requestKey]);
  const layout = design?.value.layout ?? applied?.layout ?? 'hearth';
  const templateName = applied?.templateName ?? 'Домашняя страница';
  const printReady =
    !loading && !current.error && assetsStatus === 'ready' && layoutStatus === 'ready';
  return (
    <section
      ref={root}
      className="recipe-book-view"
      aria-labelledby="recipe-book-title"
      data-print-ready={printReady}
      data-print-content={hasUnsavedContent ? 'local-preview' : 'saved'}
    >
      <header className="recipe-book-actions">
        <div>
          <p className="eyebrow">Просмотр книжной страницы</p>
          <h2 id="recipe-book-title">{value.content.title || 'Рецепт без названия'}</h2>
          <p className="muted text-sm">
            Макет: {templateName}.{' '}
            {hasUnsavedContent
              ? 'Есть несохранённые изменения: печать использует локальное содержание и сохранённое оформление.'
              : 'Содержание и оформление сохранены.'}
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={!printReady}
          onClick={() => {
            if (
              printReady &&
              document.fonts.status === 'loaded' &&
              root.current?.querySelector('[data-layout-status="ready"]') &&
              [...root.current.querySelectorAll('img')].every(
                (image) => image.complete && image.naturalWidth > 0,
              )
            )
              window.print();
          }}
        >
          Печать / PDF
        </button>
      </header>
      {loading && <p role="status">Открываем оформление…</p>}
      {current?.error && (
        <div className="recipe-notice" role="alert">
          <p>
            Сохранённое оформление недоступно. Печать заблокирована: стандартный макет не заменяет
            его.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Повторить загрузку оформления
          </button>
        </div>
      )}
      {!loading && (assetsStatus === 'loading' || layoutStatus === 'measuring') && (
        <p role="status">Проверяем раскладку для печати…</p>
      )}
      {layoutStatus === 'overflow' && (
        <p className="recipe-notice" role="alert">
          Некоторые блоки не помещаются на лист A4. Печать отключена, чтобы текст не пропал;
          сократите длинные поля или выберите более широкий шаблон.
        </p>
      )}
      {layoutStatus === 'error' && (
        <div role="alert" className="recipe-notice">
          <p>Шрифты или изображения не готовы. Печать недоступна.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => window.location.reload()}
          >
            Перезагрузить страницу и повторить
          </button>
        </div>
      )}
      <p className="recipe-print-blocked">
        Документ не готов к печати. Вернитесь в приложение и дождитесь загрузки оформления, шрифтов
        и изображений.
      </p>
      {current && !current.error && (
        <RecipePagePreview
          key={requestKey}
          recipeId={recipeId}
          recipeRevision={recipeRevision}
          templateId={applied?.templateId ?? null}
          templateRevision={applied?.revision ?? 1}
          templateName={templateName}
          layout={layout}
          theme={design?.value.theme ?? applied?.theme ?? DEFAULT_RECIPE_THEME}
          {...(design ? { designElements: design.value.elements } : {})}
          value={value}
          tags={tags}
          coverPhoto={coverPhoto}
          photos={photos}
          assetRefreshKey={assetRefreshKey}
          onAssetsStatusChange={setAssetsStatus}
          onLayoutStatusChange={setLayoutStatus}
        />
      )}
    </section>
  );
}
