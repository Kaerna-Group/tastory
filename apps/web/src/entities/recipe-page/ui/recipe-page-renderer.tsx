import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { buildRecipePageDocument } from '../model/page-document';
import type {
  RecipeDocumentElement,
  RecipeDocumentPage,
  RecipePageContent,
  RecipePageDocument,
  RecipePageFragment,
  RecipePageMeasureKind,
  RecipePageMeasurer,
  RecipePageRenderOptions,
  RecipePageTextFragment,
} from '../model/page-document';
import './recipe-page-renderer.css';

export type RecipePageRendererProps = RecipePageRenderOptions &
  Readonly<{
    value: Parameters<typeof buildRecipePageDocument>[0];
    compact?: boolean;
    coverImageSource?: string;
    stickers?: readonly RecipePageSticker[];
    onLayoutStatusChange?: (status: RecipePageLayoutStatus) => void;
    onDocumentPagesChange?: (pages: readonly string[]) => void;
    onDocumentChange?: (document: RecipePageDocument) => void;
    pageView?: 'reading' | 'a4';
    compositionEditable?: boolean;
    selectedCompositionKey?: string | null;
  }>;

export type RecipePageLayoutStatus = 'measuring' | 'ready' | 'overflow' | 'error';
export type RecipePageSticker = Readonly<{
  id: string;
  page: number;
  pageId?: string;
  name: string;
  emoji: string;
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}>;

const EMPTY_DESIGN_ELEMENTS: NonNullable<RecipePageRenderOptions['designElements']> = [];

const fragmentAttributes = (item: RecipePageFragment) => ({
  'data-fragment-index': item.fragmentIndex,
  'data-source-key': item.sourceKey,
  'data-source-index': item.sourceIndex,
  'data-source-start': item.sourceStart,
  'data-source-end': item.sourceEnd,
});

function PageList({
  items,
  kind,
}: {
  items: readonly RecipePageFragment[];
  kind: 'ingredient' | 'step';
}) {
  if (!items.length)
    return (
      <p className="recipe-page-empty">
        {kind === 'ingredient' ? 'Добавьте продукты' : 'Добавьте шаги'}
      </p>
    );
  return (
    <ol className={`recipe-page-list recipe-page-list-${kind}`}>
      {items.map((item) => (
        <li
          key={item.key}
          {...fragmentAttributes(item)}
          data-continuation={item.continuation || undefined}
        >
          <span className="recipe-page-list-mark" aria-hidden="true">
            {item.continuation ? '↳' : kind === 'ingredient' ? '•' : item.sourceIndex + 1}
          </span>
          <span className="recipe-page-fragment-text">{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

function FragmentText({ items }: { items: readonly RecipePageTextFragment[] }) {
  return items.map((item) => (
    <span key={item.key} {...fragmentAttributes(item)} className="recipe-page-fragment-text">
      {item.text}
    </span>
  ));
}

function pageHeading(page: RecipeDocumentPage, content: RecipePageContent) {
  if (page.kind === 'opening') return content.title;
  if (page.kind === 'story') return 'История рецепта';
  if (page.kind === 'notes') return 'Заметки';
  if (page.kind === 'photos')
    return (
      content.photos[
        page.elements.find((element) => element.binding === 'photos')?.sourceStart ?? 0
      ]?.caption ?? 'Фотографии'
    );
  return 'Продолжение';
}

function RecipeSheet({
  page,
  content,
  layout,
  compact,
  totalMinutes,
  servings,
  coverImageSource,
  stickers,
  designElements,
  compositionEditable,
  selectedCompositionKey,
}: {
  page: RecipeDocumentPage;
  content: RecipePageContent;
  layout: RecipePageRenderOptions['layout'];
  compact: boolean;
  totalMinutes: number | null;
  servings: number | null;
  coverImageSource?: string;
  stickers: readonly RecipePageSticker[];
  designElements: NonNullable<RecipePageRenderOptions['designElements']>;
  compositionEditable: boolean;
  selectedCompositionKey: string | null;
}) {
  const opening = page.kind === 'opening';
  const elementProps = (element: RecipeDocumentElement, extraClass = '') => {
    const authored = designElements.find((candidate) => candidate.binding === element.binding);
    const compositionKey = `content:${element.binding}`;
    return {
      className: `recipe-page-element recipe-page-element-${element.binding}${selectedCompositionKey === compositionKey ? ' is-composition-selected' : ''}${extraClass ? ` ${extraClass}` : ''}`,
      'data-page-element': element.id,
      'data-design-element': authored?.id,
      'data-composition-key': compositionKey,
      'data-composition-kind': 'content',
      'data-binding': element.binding,
      'data-region': element.region,
      style: {
        left: `${element.x}%`,
        top: `${element.y}%`,
        width: `${element.width}%`,
        height: `${element.height}%`,
        zIndex: element.zIndex,
        transform: authored ? `rotate(${authored.rotation}deg)` : undefined,
      } satisfies CSSProperties,
    };
  };
  const renderElement = (element: RecipeDocumentElement) => {
    const frame = (extraClass = '') => elementProps(element, extraClass);
    switch (element.binding) {
      case 'title':
        return (
          <header
            key={element.id}
            {...frame(`recipe-page-title${opening ? '' : ' recipe-page-title-continuation'}`)}
          >
            <p className="template-page-kicker">
              {opening ? content.kicker : 'Продолжение рецепта'}
            </p>
            <h3>{pageHeading(page, content)}</h3>
          </header>
        );
      case 'description':
        return page.kind === 'story' ? (
          <section key={element.id} {...frame('recipe-page-narrative')}>
            <p>
              <FragmentText
                items={content.description.slice(element.sourceStart, element.sourceEnd)}
              />
            </p>
          </section>
        ) : (
          <p key={element.id} {...frame('recipe-page-description')}>
            <FragmentText
              items={content.description.slice(element.sourceStart, element.sourceEnd)}
            />
          </p>
        );
      case 'meta':
        return (
          <div key={element.id} {...frame('template-page-meta')}>
            <span>{servings === null ? 'Для близких' : `${servings} порц.`}</span>
            <span>{totalMinutes === null ? 'В своём ритме' : `${totalMinutes} мин.`}</span>
          </div>
        );
      case 'cover':
        return coverImageSource ? (
          <figure key={element.id} {...frame('recipe-page-cover')}>
            <img src={coverImageSource} alt={`Главная фотография рецепта: ${content.title}`} />
          </figure>
        ) : null;
      case 'photos': {
        const photo = content.photos[element.sourceStart];
        return photo ? (
          <figure
            key={element.id}
            {...frame('recipe-page-photo')}
            data-photo-id={photo.id}
            data-photo-kind={photo.kind}
          >
            <img src={photo.source} alt={`${content.title} — ${photo.caption}`} />
            <figcaption>{photo.caption}</figcaption>
          </figure>
        ) : null;
      }
      case 'ingredients':
        return (
          <section key={element.id} {...frame('template-page-column')}>
            <h4>{opening ? 'Ингредиенты' : 'Ингредиенты · продолжение'}</h4>
            <PageList
              items={content.ingredients.slice(element.sourceStart, element.sourceEnd)}
              kind="ingredient"
            />
          </section>
        );
      case 'steps':
        return (
          <section key={element.id} {...frame('template-page-column')}>
            <h4>{opening ? 'Приготовление' : 'Приготовление · продолжение'}</h4>
            <PageList
              items={content.steps.slice(element.sourceStart, element.sourceEnd)}
              kind="step"
            />
          </section>
        );
      case 'notes':
        return (
          <section key={element.id} {...frame('recipe-page-narrative')}>
            <p>
              <FragmentText items={content.notes.slice(element.sourceStart, element.sourceEnd)} />
            </p>
          </section>
        );
      case 'source':
        return (
          <a
            key={element.id}
            {...frame('recipe-page-footer-item recipe-page-source')}
            href={content.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Источник рецепта · {new URL(content.sourceUrl).hostname}
          </a>
        );
      case 'tags':
        return (
          <span key={element.id} {...frame('recipe-page-footer-item recipe-page-tags')}>
            {content.tags.slice(element.sourceStart, element.sourceEnd).join(' · ')}
          </span>
        );
    }
  };
  return (
    <article
      className={`template-recipe-page recipe-page-sheet${compact ? ' template-recipe-page-compact' : ''}`}
      data-layout={layout}
      data-page-kind={page.kind}
      data-document-page={page.id}
      data-composition-editable={compositionEditable || undefined}
      aria-label={`Страница ${page.index + 1}: ${content.title}`}
    >
      <span className="recipe-page-sheet-frame" aria-hidden="true" />
      <span className="recipe-page-number">{String(page.index + 1).padStart(2, '0')}</span>
      <div className="template-page-mark" aria-hidden="true">
        {layout === 'coffeehouse' ||
        layout === 'tea-ceremony' ||
        layout === 'cocktail-night' ||
        layout === 'fresh-bar' ||
        layout === 'wine-cellar'
          ? '◌'
          : '✦'}
      </div>
      {page.elements.map(renderElement)}
      {stickers.map((sticker) => (
        <span
          key={sticker.id}
          className={`recipe-page-sticker${selectedCompositionKey === `sticker:${sticker.id}` ? ' is-composition-selected' : ''}`}
          data-page-sticker={sticker.id}
          data-composition-key={`sticker:${sticker.id}`}
          data-composition-kind="decor"
          aria-hidden="true"
          style={{
            left: `${sticker.x}%`,
            top: `${sticker.y}%`,
            width: `${sticker.width}%`,
            height: `${sticker.height}%`,
            zIndex: 100 + sticker.zIndex,
            transform: `rotate(${sticker.rotation}deg)`,
          }}
        >
          {sticker.source ? <img src={sticker.source} alt="" /> : sticker.emoji}
        </span>
      ))}
    </article>
  );
}

function MeasurementProbes({
  layout,
  kicker,
  root,
}: {
  layout: RecipePageRenderOptions['layout'];
  kicker: string;
  root: RefObject<HTMLDivElement | null>;
}) {
  const listProbe = (kind: 'ingredients' | 'steps', heading: string) => (
    <section className="recipe-page-measure-probe template-page-column" data-measure-kind={kind}>
      <h4>{heading}</h4>
      <ol
        className={`recipe-page-list recipe-page-list-${kind === 'ingredients' ? 'ingredient' : 'step'}`}
      >
        <li data-measure-item>
          <span className="recipe-page-list-mark" aria-hidden="true">
            •
          </span>
          <span className="recipe-page-fragment-text" data-measure-text />
        </li>
      </ol>
    </section>
  );
  return (
    <div
      ref={root}
      className="recipe-page-layout-probes"
      data-layout={layout}
      aria-hidden="true"
      inert
    >
      <header
        className="recipe-page-measure-probe recipe-page-title"
        data-measure-kind="opening-title"
      >
        <p className="template-page-kicker">{kicker}</p>
        <h3 data-measure-text />
      </header>
      <header
        className="recipe-page-measure-probe recipe-page-title recipe-page-title-continuation"
        data-measure-kind="continuation-title"
      >
        <p className="template-page-kicker">Продолжение рецепта</p>
        <h3 data-measure-text />
      </header>
      <p
        className="recipe-page-measure-probe recipe-page-description"
        data-measure-kind="description"
      >
        <span data-measure-text />
      </p>
      <div className="recipe-page-measure-probe template-page-meta" data-measure-kind="meta">
        <span>6 порц.</span>
        <span>60 мин.</span>
      </div>
      {listProbe('ingredients', 'Ингредиенты')}
      {listProbe('steps', 'Приготовление')}
      <section
        className="recipe-page-measure-probe recipe-page-narrative"
        data-measure-kind="story"
      >
        <p data-measure-text />
      </section>
      <section
        className="recipe-page-measure-probe recipe-page-narrative"
        data-measure-kind="notes"
      >
        <p data-measure-text />
      </section>
    </div>
  );
}

function createDomMeasurer(root: HTMLDivElement): RecipePageMeasurer {
  const probes = new Map<RecipePageMeasureKind, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-measure-kind]')) {
    const kind = element.dataset['measureKind'] as RecipePageMeasureKind | undefined;
    if (kind) probes.set(kind, element);
  }
  const list = probes.get('ingredients')?.querySelector<HTMLElement>('.recipe-page-list');
  const gap = list ? Number.parseFloat(getComputedStyle(list).rowGap) || 0 : 0;
  return {
    mode: 'measured',
    pageWidthPx: 794,
    pageHeightPx: 1123,
    gapPx: gap,
    measure(kind, text, widthPx, continuation) {
      const probe = probes.get(kind);
      if (!probe) throw new Error(`Missing recipe page measurement probe: ${kind}.`);
      probe.style.width = `${widthPx}px`;
      probe.dataset['continuation'] = continuation ? 'true' : 'false';
      const textNode = probe.querySelector<HTMLElement>('[data-measure-text]');
      if (textNode) textNode.textContent = text;
      const item = probe.querySelector<HTMLElement>('[data-measure-item]');
      if (item) item.hidden = !text;
      return Math.ceil(probe.getBoundingClientRect().height);
    },
  };
}

function hasDomOverflow(root: HTMLElement) {
  const elements = [
    ...root.querySelectorAll<HTMLElement>('[data-page-element], [data-page-sticker]'),
  ];
  const failures = elements.flatMap((element) => {
    const sheet = element.closest<HTMLElement>('.recipe-page-sheet');
    const elementRect = element.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    const failed =
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1 ||
      !sheetRect ||
      elementRect.left < sheetRect.left - 1 ||
      elementRect.top < sheetRect.top - 1 ||
      elementRect.right > sheetRect.right + 1 ||
      elementRect.bottom > sheetRect.bottom + 1;
    return failed
      ? [
          `${element.dataset['pageElement'] ?? element.dataset['pageSticker']}:${element.scrollWidth}x${element.scrollHeight}/${element.clientWidth}x${element.clientHeight}`,
        ]
      : [];
  });
  root.dataset['layoutOverflowElements'] = failures.join(',');
  return failures.length > 0;
}

function hasA4Overflow(root: HTMLElement) {
  // Verify the same document at print dimensions, even when mobile reading uses semantic reflow.
  const copy = root.cloneNode(true) as HTMLElement;
  copy.classList.add('recipe-page-spread-a4');
  copy.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;max-width:none;visibility:hidden;--recipe-page-scale:1';
  copy.querySelectorAll('.recipe-page-layout-probes').forEach((probe) => probe.remove());
  root.parentElement?.append(copy);
  try {
    const overflow = hasDomOverflow(copy);
    root.dataset['layoutOverflowElements'] = copy.dataset['layoutOverflowElements'] ?? '';
    return overflow;
  } finally {
    copy.remove();
  }
}

export function RecipePageRenderer(props: RecipePageRendererProps) {
  const root = useRef<HTMLDivElement>(null);
  const probes = useRef<HTMLDivElement>(null);
  const onLayoutStatusChange = props.onLayoutStatusChange;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || props.pageView !== 'a4') return;
    const resize = () =>
      element.style.setProperty(
        '--recipe-page-scale',
        String(Math.min(1, element.clientWidth / 794)),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.pageView]);
  const designElements = props.designElements ?? EMPTY_DESIGN_ELEMENTS;
  const options = useMemo<RecipePageRenderOptions>(
    () => ({
      recipeId: props.recipeId,
      recipeRevision: props.recipeRevision,
      templateId: props.templateId,
      templateRevision: props.templateRevision,
      templateName: props.templateName,
      layout: props.layout,
      tagNames: props.tagNames,
      hasCover: Boolean(props.coverImageSource),
      measurementKey: [
        props.measurementKey ?? '',
        ...(props.stickers ?? []).map(
          (sticker) =>
            `${sticker.id}:${sticker.source.length}:${sticker.x}:${sticker.y}:${sticker.width}:${sticker.height}:${sticker.rotation}`,
        ),
      ].join('|'),
      designElements,
      ...(props.photos ? { photos: props.photos } : {}),
    }),
    [
      props.coverImageSource,
      props.layout,
      props.measurementKey,
      props.recipeId,
      props.recipeRevision,
      props.tagNames,
      props.templateId,
      props.templateName,
      props.templateRevision,
      props.stickers,
      designElements,
      props.photos,
    ],
  );
  const estimated = useMemo(
    () => buildRecipePageDocument(props.value, options),
    [options, props.value],
  );
  const [measured, setMeasured] = useState<{
    source: typeof estimated;
    result: typeof estimated;
  } | null>(null);
  const model = measured?.source === estimated ? measured.result : estimated;
  const [verified, setVerified] = useState<{
    source: typeof estimated;
    status: Exclude<RecipePageLayoutStatus, 'measuring'>;
  } | null>(null);
  const layoutStatus: RecipePageLayoutStatus =
    verified?.source === model && (model.measurement === 'measured' || verified.status === 'error')
      ? verified.status
      : 'measuring';
  const invalidStickers = (props.stickers ?? []).filter(
    (sticker) =>
      !model.document.pages.some((page) => page.id === (sticker.pageId ?? `page-${sticker.page}`)),
  );
  const onDocumentPagesChange = props.onDocumentPagesChange;
  const onDocumentChange = props.onDocumentChange;
  useLayoutEffect(() => {
    if (model.measurement === 'measured') {
      onDocumentPagesChange?.(model.document.pages.map((page) => page.id));
      onDocumentChange?.(model.document);
    }
  }, [model, onDocumentChange, onDocumentPagesChange]);

  useLayoutEffect(() => {
    if (props.compact) return;
    let cancelled = false;
    let frame = 0;
    onLayoutStatusChange?.('measuring');
    const measure = async () => {
      const fontSpecs = new Set(
        [...(probes.current?.querySelectorAll('h3, h4, p, li') ?? [])]
          .map((element) => getComputedStyle(element).font)
          .filter(Boolean),
      );
      await Promise.all(
        [...fontSpecs].map((font) => document.fonts.load(font, 'Рецепт 0123456789')),
      );
      await document.fonts?.ready;
      const current = root.current;
      await Promise.all(
        [...(current?.querySelectorAll('img') ?? [])].map((image) => image.decode()),
      );
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        if (cancelled || !probes.current) return;
        setMeasured({
          source: estimated,
          result: buildRecipePageDocument(props.value, options, createDomMeasurer(probes.current)),
        });
      });
    };
    void measure().catch(() => {
      if (!cancelled) {
        setVerified({ source: estimated, status: 'error' });
        onLayoutStatusChange?.('error');
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [estimated, onLayoutStatusChange, options, props.compact, props.value]);

  useLayoutEffect(() => {
    if (props.compact || model.measurement !== 'measured') return;
    const frame = requestAnimationFrame(() => {
      const overflow =
        model.overflow ||
        invalidStickers.length > 0 ||
        !root.current ||
        hasA4Overflow(root.current);
      const status = overflow ? 'overflow' : 'ready';
      setVerified({ source: model, status });
      onLayoutStatusChange?.(status);
    });
    return () => cancelAnimationFrame(frame);
  }, [model, onLayoutStatusChange, props.compact, props.pageView, invalidStickers.length]);

  const pages = props.compact ? model.document.pages.slice(0, 1) : model.document.pages;
  return (
    <div
      ref={root}
      className={`recipe-page-spread${props.compact ? ' recipe-page-spread-compact' : ''}${props.pageView === 'a4' ? ' recipe-page-spread-a4' : ''}${props.compositionEditable ? ' recipe-page-composition-editable' : ''}`}
      data-layout-status={props.compact ? undefined : layoutStatus}
      data-layout-measurement={model.measurement}
    >
      {invalidStickers.length > 0 && (
        <p role="alert" className="recipe-notice">
          Для {invalidStickers.length} стикеров страница больше не существует. Размещения сохранены;
          выберите страницу в разделе «Стикер-паки».
        </p>
      )}
      {!props.compact && model.hasLongContent && (
        <p className="recipe-page-flow-note" role="status">
          Длинный рецепт аккуратно продолжен: {model.document.pages.length} стр.
        </p>
      )}
      {pages.map((page) => (
        <RecipeSheet
          key={page.id}
          page={page}
          content={model.content}
          layout={model.document.layout}
          compact={Boolean(props.compact)}
          totalMinutes={model.totalMinutes}
          servings={model.servings}
          coverImageSource={page.kind === 'opening' ? (props.coverImageSource ?? '') : ''}
          stickers={(props.stickers ?? []).filter(
            (sticker) => (sticker.pageId ?? `page-${sticker.page}`) === page.id,
          )}
          designElements={props.designElements ?? []}
          compositionEditable={Boolean(props.compositionEditable)}
          selectedCompositionKey={props.selectedCompositionKey ?? null}
        />
      ))}
      {!props.compact && (
        <MeasurementProbes layout={props.layout} kicker={model.content.kicker} root={probes} />
      )}
    </div>
  );
}
