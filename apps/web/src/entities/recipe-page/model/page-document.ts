import {
  RECIPE_PAGE_DOCUMENT_VERSION,
  recipePageDocumentSchema,
  templateCategoryForLayout,
} from '@tastory/contracts';
import type {
  RecipeDraftValue,
  RecipePage,
  RecipePageBinding,
  RecipePageDocument,
  RecipePageElement,
  RecipeDesignElement,
  RecipeTemplateLayout,
} from '@tastory/contracts';

export type { RecipePageBinding, RecipePageDocument } from '@tastory/contracts';

export type RecipeDocumentPage = RecipePage;
export type RecipeDocumentElement = RecipePageElement;

export type RecipePagePhoto = Readonly<{
  id: string;
  kind: 'step' | 'gallery';
  stepId: string | null;
  position: number;
  source: string;
}>;

export type RecipePageFragment = Readonly<{
  key: string;
  fragmentIndex: number;
  sourceKey: string;
  sourceIndex: number;
  sourceStart: number;
  sourceEnd: number;
  partIndex: number;
  text: string;
  continuation: boolean;
}>;
export type RecipePageTextFragment = RecipePageFragment;

export type RecipePageContent = Readonly<{
  title: string;
  kicker: string;
  description: readonly RecipePageTextFragment[];
  ingredients: readonly RecipePageFragment[];
  steps: readonly RecipePageFragment[];
  notes: readonly RecipePageTextFragment[];
  tags: readonly string[];
  sourceUrl: string;
  photos: readonly (RecipePagePhoto & { caption: string })[];
}>;

export type RecipePageRenderOptions = Readonly<{
  recipeId: string;
  recipeRevision: number | null;
  templateId: string | null;
  templateRevision: number;
  templateName: string;
  layout: RecipeTemplateLayout;
  tagNames: readonly string[];
  hasCover?: boolean;
  measurementKey?: string;
  designElements?: readonly RecipeDesignElement[];
  photos?: readonly RecipePagePhoto[];
}>;

export type RecipePageDesign = Readonly<{
  recipeId: string;
  recipeRevision: number | null;
  templateId: string | null;
  templateRevision: number;
  templateName: string;
  layout: RecipeTemplateLayout;
  pageWidthMm: 210;
  pageHeightMm: 297;
  frameX: number;
  frameWidth: number;
  sidebarWidth: number;
  columnGap: number;
  titleWidth: number;
  contentBottom: number;
  footerTop: number;
  coverHeight: number;
  coverPlacement: 'banner' | 'side';
  hasCover: boolean;
  measurementKey: string;
  designElements: readonly RecipeDesignElement[];
}>;

export type RecipePageMeasureKind =
  | 'opening-title'
  | 'continuation-title'
  | 'description'
  | 'meta'
  | 'ingredients'
  | 'steps'
  | 'story'
  | 'notes';

export type RecipePageMeasurer = Readonly<{
  mode: 'estimated' | 'measured';
  pageWidthPx: number;
  pageHeightPx: number;
  gapPx: number;
  measure: (
    kind: RecipePageMeasureKind,
    text: string,
    widthPx: number,
    continuation: boolean,
  ) => number;
}>;

export type RecipePageRenderModel = Readonly<{
  design: RecipePageDesign;
  document: RecipePageDocument;
  content: RecipePageContent;
  totalMinutes: number | null;
  servings: number | null;
  hasLongContent: boolean;
  measurement: RecipePageMeasurer['mode'];
  overflow: boolean;
}>;

type SourceText = Readonly<{ key: string; sourceIndex: number; text: string }>;
type SourceCursor = { sourceIndex: number; sourceStart: number; partIndex: number };
type ElementGeometry = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  region: RecipePageElement['region'];
}>;
type PageDraft = Readonly<{
  kind: RecipePage['kind'];
  elements: readonly Omit<RecipePageElement, 'id'>[];
}>;

type LayoutGeometry = Readonly<{
  frameX: number;
  frameWidth: number;
  sidebarRatio: number;
  gapRatio: number;
  titleRatio: number;
  coverHeight: number;
  coverPlacement: RecipePageDesign['coverPlacement'];
  contentBottom?: number;
  footerTop?: number;
}>;

const geometry = (
  frameX: number,
  frameWidth: number,
  overrides: Partial<Omit<LayoutGeometry, 'frameX' | 'frameWidth'>> = {},
): LayoutGeometry => ({
  frameX,
  frameWidth,
  sidebarRatio: 0.36,
  gapRatio: 0.05,
  titleRatio: 1,
  coverHeight: 24,
  coverPlacement: 'banner',
  ...overrides,
});

const LAYOUT_GEOMETRY: Record<RecipeTemplateLayout, LayoutGeometry> = {
  hearth: geometry(8, 84),
  bistro: geometry(24, 68),
  herbarium: geometry(14, 78),
  celebration: geometry(8, 84),
  notebook: geometry(14, 78),
  'pastel-notebook': geometry(7, 86, {
    sidebarRatio: 0.48,
    gapRatio: 0.04,
    coverHeight: 17,
    contentBottom: 90,
    footerTop: 93,
  }),
  'berry-diary': geometry(6, 88, {
    sidebarRatio: 0.4,
    gapRatio: 0.05,
    titleRatio: 0.55,
    coverHeight: 27,
    coverPlacement: 'side',
    contentBottom: 90,
    footerTop: 93,
  }),
  'lined-notebook': geometry(8, 84, {
    sidebarRatio: 0.36,
    gapRatio: 0.06,
    titleRatio: 0.5,
    coverHeight: 24,
    coverPlacement: 'side',
    contentBottom: 90,
    footerTop: 93,
  }),
  'clean-card': geometry(7, 86, {
    sidebarRatio: 0.42,
    gapRatio: 0.07,
    coverHeight: 15,
    contentBottom: 90,
    footerTop: 93,
  }),
  coffeehouse: geometry(8, 84, { titleRatio: 0.58 }),
  'tea-ceremony': geometry(14, 72),
  'cocktail-night': geometry(8, 84, { titleRatio: 66 / 84 }),
  'fresh-bar': geometry(8, 68),
  'wine-cellar': geometry(14, 72),
};

const round = (value: number) => Math.round(value * 100) / 100;
const visible = (value: string) => /\S/u.test(value);

function ingredientText(value: RecipeDraftValue['ingredients'][number]) {
  const amount =
    value.quantityText || (value.quantityValue === null ? '' : String(value.quantityValue));
  return [
    value.sectionTitle ? `${value.sectionTitle}:` : '',
    value.name,
    amount ? `— ${amount}${value.unit ? ` ${value.unit}` : ''}` : '',
    value.isOptional ? '(по желанию)' : '',
    value.note,
  ]
    .filter(Boolean)
    .join(' ');
}

function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function stepText(value: RecipeDraftValue['steps'][number]) {
  const seconds = value.durationSeconds;
  const duration =
    seconds === null
      ? ''
      : [
          Math.floor(seconds / 60) ? `${Math.floor(seconds / 60)} мин` : '',
          seconds % 60 || seconds === 0 ? `${seconds % 60} сек` : '',
        ]
          .filter(Boolean)
          .join(' ');
  return [
    value.sectionTitle ? `${value.sectionTitle}:` : '',
    value.body,
    duration ? `(${duration})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function listSources(value: RecipeDraftValue) {
  const ingredients: SourceText[] = [];
  value.ingredients.forEach((item, sourceIndex) => {
    if (item.name.trim())
      ingredients.push({ key: item.key, sourceIndex, text: ingredientText(item) });
  });
  const steps: SourceText[] = [];
  value.steps.forEach((item, sourceIndex) => {
    if (item.body.trim()) steps.push({ key: item.key, sourceIndex, text: stepText(item) });
  });
  return { ingredients, steps };
}

export function buildRecipePageDesign(options: RecipePageRenderOptions): RecipePageDesign {
  const layout = LAYOUT_GEOMETRY[options.layout];
  const { frameX, frameWidth } = layout;
  const sidebarWidth = round(frameWidth * layout.sidebarRatio);
  const columnGap = round(frameWidth * layout.gapRatio);
  const titleWidth = round(frameWidth * layout.titleRatio);
  return {
    ...options,
    pageWidthMm: 210,
    pageHeightMm: 297,
    frameX,
    frameWidth,
    sidebarWidth,
    columnGap,
    titleWidth,
    contentBottom: layout.contentBottom ?? 89,
    footerTop: layout.footerTop ?? 92,
    coverHeight: layout.coverHeight,
    coverPlacement: layout.coverPlacement,
    hasCover: Boolean(options.hasCover),
    measurementKey: options.measurementKey ?? '',
    designElements: options.designElements ?? [],
  };
}

function estimatedLines(text: string, widthPx: number, characterWidth: number) {
  if (!text) return 0;
  const columns = Math.max(1, Math.floor(widthPx / characterWidth));
  return text
    .split('\n')
    .reduce(
      (total, paragraph) => total + Math.max(1, Math.ceil(Array.from(paragraph).length / columns)),
      0,
    );
}

export const estimatedRecipePageMeasurer: RecipePageMeasurer = {
  mode: 'estimated',
  pageWidthPx: 794,
  pageHeightPx: 1123,
  gapPx: 10,
  measure(kind, text, widthPx) {
    switch (kind) {
      case 'opening-title':
        return 30 + estimatedLines(text, widthPx, 34) * 67;
      case 'continuation-title':
        return 22 + estimatedLines(text, widthPx, 17) * 34;
      case 'description':
        return estimatedLines(text, widthPx, 8) * 26;
      case 'meta':
        return 45;
      case 'ingredients':
      case 'steps':
        return 31 + (text ? estimatedLines(text, widthPx - 32, 8) * 21 : 0);
      case 'story':
      case 'notes':
        return estimatedLines(text, widthPx, 11) * 40;
    }
  },
};

const pxWidth = (percent: number, measure: RecipePageMeasurer) =>
  (percent / 100) * measure.pageWidthPx;
const pxHeight = (percent: number, measure: RecipePageMeasurer) =>
  (percent / 100) * measure.pageHeightPx;
const heightPercent = (pixels: number, measure: RecipePageMeasurer) =>
  round((pixels / measure.pageHeightPx) * 100);

function fittingEnd(text: string, start: number, fits: (candidate: string) => boolean): number {
  if (start >= text.length) return start;
  if (fits(text.slice(start))) return text.length;
  const offsets = [start];
  for (let offset = start; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    offsets.push(offset);
  }
  let low = 0;
  let high = offsets.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const end = offsets[middle] ?? start;
    if (fits(text.slice(start, end))) low = middle;
    else high = middle;
  }
  let end = offsets[low] ?? start;
  if (end <= start) return start;
  const candidate = text.slice(start, end);
  const lfBreak = candidate.lastIndexOf('\n\n');
  const crlfBreak = candidate.lastIndexOf('\r\n\r\n');
  const paragraphEnd = Math.max(lfBreak < 0 ? -1 : lfBreak + 2, crlfBreak < 0 ? -1 : crlfBreak + 4);
  const wordBreak = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'));
  const preferred =
    paragraphEnd >= Math.floor(candidate.length * 0.35) ? paragraphEnd : wordBreak + 1;
  if (preferred > 0 && fits(candidate.slice(0, preferred))) end = start + preferred;
  return end;
}

function appendFragment(
  target: RecipePageFragment[],
  source: SourceText,
  start: number,
  end: number,
  partIndex: number,
) {
  const next: RecipePageFragment = {
    key: `${source.key}:${start}:${end}`,
    fragmentIndex: target.length,
    sourceKey: source.key,
    sourceIndex: source.sourceIndex,
    sourceStart: start,
    sourceEnd: end,
    partIndex,
    text: source.text.slice(start, end),
    continuation: partIndex > 0,
  };
  target.push(next);
  return next;
}

function packList(
  sources: readonly SourceText[],
  cursor: SourceCursor,
  target: RecipePageFragment[],
  kind: 'ingredients' | 'steps',
  widthPercent: number,
  heightPercent: number,
  measure: RecipePageMeasurer,
) {
  const startIndex = target.length;
  if (heightPercent <= 0) return { startIndex, endIndex: startIndex, progressed: false };
  const width = pxWidth(widthPercent, measure);
  const capacity = pxHeight(heightPercent, measure) - 2;
  const base = measure.measure(kind, '', width, false);
  let used = base;
  while (cursor.sourceIndex < sources.length) {
    const source = sources[cursor.sourceIndex];
    if (!source) break;
    const separator = target.length === startIndex ? 0 : measure.gapPx;
    const incremental = (text: string) =>
      Math.max(0, measure.measure(kind, text, width, cursor.sourceStart > 0) - base);
    const remaining = source.text.slice(cursor.sourceStart);
    let end = source.text.length;
    if (used + separator + incremental(remaining) > capacity)
      end = fittingEnd(
        source.text,
        cursor.sourceStart,
        (candidate) => used + separator + incremental(candidate) <= capacity,
      );
    if (end <= cursor.sourceStart) break;
    appendFragment(target, source, cursor.sourceStart, end, cursor.partIndex);
    used += separator + incremental(source.text.slice(cursor.sourceStart, end));
    cursor.partIndex += 1;
    cursor.sourceStart = end;
    if (end < source.text.length) break;
    cursor.sourceIndex += 1;
    cursor.sourceStart = 0;
    cursor.partIndex = 0;
  }
  return { startIndex, endIndex: target.length, progressed: target.length > startIndex };
}

function packNarrative(
  source: SourceText,
  cursor: SourceCursor,
  target: RecipePageFragment[],
  kind: 'description' | 'story' | 'notes',
  widthPercent: number,
  heightPercent: number,
  measure: RecipePageMeasurer,
) {
  const startIndex = target.length;
  if (cursor.sourceStart >= source.text.length || heightPercent <= 0)
    return { startIndex, endIndex: startIndex, progressed: false };
  const width = pxWidth(widthPercent, measure);
  const capacity = pxHeight(heightPercent, measure) - 2;
  const end = fittingEnd(
    source.text,
    cursor.sourceStart,
    (candidate) => measure.measure(kind, candidate, width, cursor.sourceStart > 0) <= capacity,
  );
  if (end <= cursor.sourceStart) return { startIndex, endIndex: startIndex, progressed: false };
  appendFragment(target, source, cursor.sourceStart, end, cursor.partIndex);
  cursor.sourceStart = end;
  cursor.partIndex += 1;
  if (end >= source.text.length) cursor.sourceIndex = 1;
  return { startIndex, endIndex: target.length, progressed: true };
}

function pageElement(
  binding: RecipePageBinding,
  geometry: ElementGeometry,
  sourceStart: number,
  sourceEnd: number,
  continuation: boolean,
): Omit<RecipePageElement, 'id'> {
  return {
    binding,
    region: geometry.region,
    sourceStart,
    sourceEnd,
    continuation,
    x: round(geometry.x),
    y: round(geometry.y),
    width: round(geometry.width),
    height: round(Math.max(0.01, geometry.height)),
    zIndex: 1,
    locked: true,
  };
}

function footerElements(design: RecipePageDesign, sourceUrl: string, tagCount: number) {
  const elements: Omit<RecipePageElement, 'id'>[] = [];
  if (sourceUrl)
    elements.push(
      pageElement(
        'source',
        {
          x: design.frameX,
          y: design.footerTop,
          width: round(design.frameWidth * 0.46),
          height: 4,
          region: 'footer',
        },
        0,
        1,
        false,
      ),
    );
  if (tagCount)
    elements.push(
      pageElement(
        'tags',
        {
          x: round(design.frameX + design.frameWidth * 0.54),
          y: design.footerTop,
          width: round(design.frameWidth * 0.46),
          height: 4,
          region: 'footer',
        },
        0,
        tagCount,
        false,
      ),
    );
  return elements;
}

function forceRemaining(
  sources: readonly SourceText[],
  cursor: SourceCursor,
  target: RecipePageFragment[],
) {
  const source = sources[cursor.sourceIndex];
  if (!source) return null;
  const startIndex = target.length;
  appendFragment(target, source, cursor.sourceStart, source.text.length, cursor.partIndex);
  cursor.sourceIndex += 1;
  cursor.sourceStart = 0;
  cursor.partIndex = 0;
  return { startIndex, endIndex: target.length };
}

export function buildRecipePageDocument(
  value: RecipeDraftValue,
  options: RecipePageRenderOptions,
  measure: RecipePageMeasurer = estimatedRecipePageMeasurer,
): RecipePageRenderModel {
  const design = buildRecipePageDesign(options);
  const title = value.content.title.trim() || 'Без названия';
  const kicker =
    options.layout === 'pastel-notebook'
      ? 'Из семейного блокнота'
      : options.layout === 'berry-diary'
        ? 'Маленький праздник'
        : options.layout === 'lined-notebook'
          ? 'Записано от руки'
          : options.layout === 'clean-card'
            ? 'Карточка рецепта'
            : templateCategoryForLayout(options.layout) === 'drink'
              ? 'Коллекция напитков'
              : 'Домашний рецепт';
  const sourceLists = listSources(value);
  const descriptionSource: SourceText = {
    key: 'description',
    sourceIndex: 0,
    text: value.content.description,
  };
  const notesSource: SourceText = { key: 'notes', sourceIndex: 0, text: value.content.notes };
  const content = {
    title,
    kicker,
    description: [] as RecipePageTextFragment[],
    ingredients: [] as RecipePageFragment[],
    steps: [] as RecipePageFragment[],
    notes: [] as RecipePageTextFragment[],
    tags: [...options.tagNames],
    sourceUrl: safeSourceUrl(value.content.sourceUrl),
    photos: [...(options.photos ?? [])]
      .sort((a, b) => {
        const aStep =
          a.kind === 'step' ? value.steps.findIndex((step) => step.key === a.stepId) : 1000;
        const bStep =
          b.kind === 'step' ? value.steps.findIndex((step) => step.key === b.stepId) : 1000;
        return aStep - bStep || a.position - b.position || a.id.localeCompare(b.id);
      })
      .map((photo) => {
        const stepIndex = value.steps.findIndex((step) => step.key === photo.stepId);
        return {
          ...photo,
          caption:
            photo.kind === 'gallery'
              ? `Галерея · фото ${photo.position + 1}`
              : stepIndex < 0
                ? 'Фото: исходный шаг отсутствует'
                : `Шаг ${stepIndex + 1} · фото ${photo.position + 1}`,
        };
      }),
  };
  const ingredientCursor: SourceCursor = { sourceIndex: 0, sourceStart: 0, partIndex: 0 };
  const stepCursor: SourceCursor = { sourceIndex: 0, sourceStart: 0, partIndex: 0 };
  const descriptionCursor: SourceCursor = { sourceIndex: 0, sourceStart: 0, partIndex: 0 };
  const notesCursor: SourceCursor = { sourceIndex: 0, sourceStart: 0, partIndex: 0 };
  const pages: PageDraft[] = [];
  let overflow = false;
  const titleMeasurementGuard =
    options.layout === 'clean-card' ? 16 : options.layout === 'berry-diary' ? 12 : 6;

  const openingElements: Omit<RecipePageElement, 'id'>[] = [];
  const sideCover = design.hasCover && design.coverPlacement === 'side';
  const headerWidth = sideCover ? design.titleWidth : design.frameWidth;
  const measuredOpeningTitleHeight = heightPercent(
    measure.measure('opening-title', title, pxWidth(design.titleWidth, measure), false) +
      titleMeasurementGuard,
    measure,
  );
  const openingTitleHeight = Math.min(45, measuredOpeningTitleHeight);
  if (measuredOpeningTitleHeight > openingTitleHeight) overflow = true;
  openingElements.push(
    pageElement(
      'title',
      {
        x: design.frameX,
        y: 6,
        width: design.titleWidth,
        height: openingTitleHeight,
        region: 'header',
      },
      0,
      1,
      false,
    ),
  );
  let openingY = 6 + openingTitleHeight + 1;
  if (visible(descriptionSource.text)) {
    const available = Math.max(0, Math.min(10, design.contentBottom - openingY));
    const range = packNarrative(
      descriptionSource,
      descriptionCursor,
      content.description,
      'description',
      headerWidth,
      available,
      measure,
    );
    if (range.progressed) {
      const actualHeight = heightPercent(
        measure.measure(
          'description',
          content.description[range.startIndex]?.text ?? '',
          pxWidth(headerWidth, measure),
          false,
        ) + 6,
        measure,
      );
      openingElements.push(
        pageElement(
          'description',
          {
            x: design.frameX,
            y: openingY,
            width: headerWidth,
            height: actualHeight,
            region: 'header',
          },
          range.startIndex,
          range.endIndex,
          false,
        ),
      );
      openingY += actualHeight + 1;
    }
  }
  const metaHeight = heightPercent(
    measure.measure('meta', '', pxWidth(headerWidth, measure), false) + 6,
    measure,
  );
  openingElements.push(
    pageElement(
      'meta',
      {
        x: design.frameX,
        y: openingY,
        width: headerWidth,
        height: metaHeight,
        region: 'header',
      },
      0,
      1,
      false,
    ),
  );
  openingY += metaHeight + 1;
  if (design.hasCover) {
    const coverWidth = sideCover
      ? design.frameWidth - design.titleWidth - design.columnGap
      : design.frameWidth;
    const coverX = sideCover ? design.frameX + design.titleWidth + design.columnGap : design.frameX;
    const coverY = sideCover ? 6 : openingY;
    openingElements.push(
      pageElement(
        'cover',
        {
          x: coverX,
          y: coverY,
          width: coverWidth,
          height: design.coverHeight,
          region: 'body',
        },
        0,
        1,
        false,
      ),
    );
    openingY = sideCover
      ? Math.max(openingY, coverY + design.coverHeight + 2)
      : openingY + design.coverHeight + 2;
  }
  const openingFlowHeight = Math.max(0, design.contentBottom - openingY);
  const ingredientsRange = packList(
    sourceLists.ingredients,
    ingredientCursor,
    content.ingredients,
    'ingredients',
    design.sidebarWidth,
    openingFlowHeight,
    measure,
  );
  const bodyWidth = design.frameWidth - design.sidebarWidth - design.columnGap;
  const bodyX = design.frameX + design.sidebarWidth + design.columnGap;
  const stepsRange = packList(
    sourceLists.steps,
    stepCursor,
    content.steps,
    'steps',
    bodyWidth,
    openingFlowHeight,
    measure,
  );
  if (ingredientsRange.progressed || sourceLists.ingredients.length === 0)
    openingElements.push(
      pageElement(
        'ingredients',
        {
          x: design.frameX,
          y: openingY,
          width: design.sidebarWidth,
          height: openingFlowHeight,
          region: 'sidebar',
        },
        ingredientsRange.startIndex,
        ingredientsRange.endIndex,
        false,
      ),
    );
  if (stepsRange.progressed || sourceLists.steps.length === 0)
    openingElements.push(
      pageElement(
        'steps',
        { x: bodyX, y: openingY, width: bodyWidth, height: openingFlowHeight, region: 'body' },
        stepsRange.startIndex,
        stepsRange.endIndex,
        false,
      ),
    );
  openingElements.push(...footerElements(design, content.sourceUrl, content.tags.length));
  pages.push({ kind: 'opening', elements: openingElements });

  let guard = 0;
  while (
    ingredientCursor.sourceIndex < sourceLists.ingredients.length ||
    stepCursor.sourceIndex < sourceLists.steps.length
  ) {
    if (++guard > 4990) throw new Error('Recipe page pagination did not converge.');
    const elements: Omit<RecipePageElement, 'id'>[] = [];
    const titleHeight = heightPercent(
      measure.measure(
        'continuation-title',
        'Продолжение',
        pxWidth(design.frameWidth, measure),
        true,
      ) + titleMeasurementGuard,
      measure,
    );
    elements.push(
      pageElement(
        'title',
        { x: design.frameX, y: 6, width: design.frameWidth, height: titleHeight, region: 'header' },
        0,
        1,
        true,
      ),
    );
    const flowY = 6 + titleHeight + 3;
    const flowHeight = Math.max(0, design.contentBottom - flowY);
    let ingredientRange = packList(
      sourceLists.ingredients,
      ingredientCursor,
      content.ingredients,
      'ingredients',
      design.sidebarWidth,
      flowHeight,
      measure,
    );
    let stepRange = packList(
      sourceLists.steps,
      stepCursor,
      content.steps,
      'steps',
      bodyWidth,
      flowHeight,
      measure,
    );
    if (
      !ingredientRange.progressed &&
      ingredientCursor.sourceIndex < sourceLists.ingredients.length
    ) {
      overflow = true;
      ingredientRange = {
        ...(forceRemaining(sourceLists.ingredients, ingredientCursor, content.ingredients) ?? {
          startIndex: content.ingredients.length,
          endIndex: content.ingredients.length,
        }),
        progressed: true,
      };
    }
    if (!stepRange.progressed && stepCursor.sourceIndex < sourceLists.steps.length) {
      overflow = true;
      stepRange = {
        ...(forceRemaining(sourceLists.steps, stepCursor, content.steps) ?? {
          startIndex: content.steps.length,
          endIndex: content.steps.length,
        }),
        progressed: true,
      };
    }
    if (ingredientRange.progressed)
      elements.push(
        pageElement(
          'ingredients',
          {
            x: design.frameX,
            y: flowY,
            width: design.sidebarWidth,
            height: flowHeight,
            region: 'sidebar',
          },
          ingredientRange.startIndex,
          ingredientRange.endIndex,
          true,
        ),
      );
    if (stepRange.progressed)
      elements.push(
        pageElement(
          'steps',
          { x: bodyX, y: flowY, width: bodyWidth, height: flowHeight, region: 'body' },
          stepRange.startIndex,
          stepRange.endIndex,
          true,
        ),
      );
    elements.push(...footerElements(design, content.sourceUrl, content.tags.length));
    pages.push({ kind: 'continuation', elements });
  }

  const paginateNarrative = (
    source: SourceText,
    cursor: SourceCursor,
    target: RecipePageFragment[],
    kind: 'story' | 'notes',
  ) => {
    while (cursor.sourceStart < source.text.length) {
      const elements: Omit<RecipePageElement, 'id'>[] = [];
      const heading = kind === 'story' ? 'История рецепта' : 'Заметки';
      const titleHeight = heightPercent(
        measure.measure('continuation-title', heading, pxWidth(design.frameWidth, measure), true) +
          titleMeasurementGuard,
        measure,
      );
      elements.push(
        pageElement(
          'title',
          {
            x: design.frameX,
            y: 6,
            width: design.frameWidth,
            height: titleHeight,
            region: 'header',
          },
          0,
          1,
          true,
        ),
      );
      const flowY = 6 + titleHeight + 3;
      const flowHeight = Math.max(0, design.contentBottom - flowY);
      let range = packNarrative(
        source,
        cursor,
        target,
        kind,
        design.frameWidth,
        flowHeight,
        measure,
      );
      if (!range.progressed) {
        overflow = true;
        const startIndex = target.length;
        appendFragment(target, source, cursor.sourceStart, source.text.length, cursor.partIndex);
        cursor.sourceStart = source.text.length;
        cursor.sourceIndex = 1;
        cursor.partIndex += 1;
        range = {
          startIndex,
          endIndex: target.length,
          progressed: true,
        };
      }
      elements.push(
        pageElement(
          kind === 'story' ? 'description' : 'notes',
          {
            x: design.frameX,
            y: flowY,
            width: design.frameWidth,
            height: flowHeight,
            region: 'body',
          },
          range.startIndex,
          range.endIndex,
          target[range.startIndex]?.continuation ?? false,
        ),
      );
      elements.push(...footerElements(design, content.sourceUrl, content.tags.length));
      pages.push({ kind, elements });
    }
  };
  if (
    visible(descriptionSource.text) &&
    descriptionCursor.sourceStart < descriptionSource.text.length
  )
    paginateNarrative(descriptionSource, descriptionCursor, content.description, 'story');
  if (visible(notesSource.text))
    paginateNarrative(notesSource, notesCursor, content.notes, 'notes');

  // Photo plates are bounded document regions, not an unmeasured list appended to a text block.
  // They follow all recipe text, so adding a photograph never changes existing text-page slots.
  content.photos.forEach((photo, index) => {
    const titleHeight = heightPercent(
      measure.measure(
        'continuation-title',
        photo.caption,
        pxWidth(design.frameWidth, measure),
        true,
      ) + titleMeasurementGuard,
      measure,
    );
    const photoY = 9 + titleHeight;
    const photoHeight = design.contentBottom - photoY;
    if (
      photoHeight < 20 ||
      (photo.kind === 'step' && !value.steps.some((step) => step.key === photo.stepId))
    )
      overflow = true;
    pages.push({
      kind: 'photos',
      elements: [
        pageElement(
          'title',
          {
            x: design.frameX,
            y: 6,
            width: design.frameWidth,
            height: Math.min(40, titleHeight),
            region: 'header',
          },
          index,
          index + 1,
          false,
        ),
        pageElement(
          'photos',
          {
            x: design.frameX,
            y: Math.min(60, photoY),
            width: design.frameWidth,
            height: Math.max(1, photoHeight),
            region: 'body',
          },
          index,
          index + 1,
          false,
        ),
        ...footerElements(design, content.sourceUrl, content.tags.length),
      ],
    });
  });

  if (openingY > design.contentBottom) overflow = true;
  const document = recipePageDocumentSchema.parse({
    version: RECIPE_PAGE_DOCUMENT_VERSION,
    recipeId: options.recipeId,
    recipeRevision: options.recipeRevision,
    templateId: options.templateId,
    templateRevision: options.templateRevision,
    layout: options.layout,
    pages: pages.map((page, index) => ({
      id: `page-${index + 1}`,
      index,
      kind: page.kind,
      widthMm: 210,
      heightMm: 297,
      elements: page.elements.map((element) => {
        const authored = design.designElements.find(
          (candidate) => candidate.binding === element.binding,
        );
        return {
          ...element,
          ...(authored
            ? {
                region: authored.region,
                x: authored.x,
                y: authored.y,
                width: authored.width,
                height: authored.height,
                zIndex: authored.zIndex,
                locked: authored.locked,
              }
            : {}),
          id: `page-${index + 1}-${element.binding}`,
        };
      }),
    })),
  });
  const totalMinutes =
    value.content.prepMinutes === null && value.content.cookMinutes === null
      ? null
      : (value.content.prepMinutes ?? 0) + (value.content.cookMinutes ?? 0);
  return {
    design,
    document,
    content,
    totalMinutes,
    servings: value.content.servings,
    hasLongContent: pages.length > 1,
    measurement: measure.mode,
    overflow,
  };
}
