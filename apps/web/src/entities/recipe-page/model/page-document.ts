import {
  RECIPE_PAGE_DOCUMENT_VERSION,
  recipePageDocumentSchema,
  templateCategoryForLayout,
} from '@tastory/contracts';
import type {
  RecipeDraftValue,
  RecipePageBinding,
  RecipePageDocument,
  RecipePageElement,
  RecipeTemplateLayout,
} from '@tastory/contracts';

export type RecipePageFragment = Readonly<{
  key: string;
  sourceIndex: number;
  partIndex: number;
  text: string;
  continuation: boolean;
}>;

export type RecipeRenderedPage = Readonly<{
  id: string;
  number: number;
  kind: 'opening' | 'continuation' | 'story' | 'notes';
  title: string;
  kicker: string;
  description: string;
  ingredients: readonly RecipePageFragment[];
  steps: readonly RecipePageFragment[];
  narrative: string;
  tags: readonly string[];
  sourceUrl: string;
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
}>;

export type RecipePageRenderModel = Readonly<{
  document: RecipePageDocument;
  pages: readonly RecipeRenderedPage[];
  totalMinutes: number | null;
  servings: number | null;
  hasLongContent: boolean;
}>;

const INGREDIENT_FRAGMENT_LENGTH = 72;
const STEP_FRAGMENT_LENGTH = 250;
const NARRATIVE_FRAGMENT_LENGTH = 760;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function splitPageText(value: string, limit: number): string[] {
  let remaining = normalizeText(value);
  if (!remaining) return [];
  const parts: string[] = [];
  while (remaining.length > limit) {
    const preferred = remaining.lastIndexOf(' ', limit);
    const cut = preferred >= Math.floor(limit * 0.55) ? preferred : limit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function fragments(values: readonly string[], limit: number, prefix: string): RecipePageFragment[] {
  return values.flatMap((value, sourceIndex) =>
    splitPageText(value, limit).map((text, partIndex) => ({
      key: `${prefix}-${sourceIndex}-${partIndex}`,
      sourceIndex,
      partIndex,
      text,
      continuation: partIndex > 0,
    })),
  );
}

function groups<T>(values: readonly T[], firstSize: number, nextSize: number): T[][] {
  if (values.length === 0) return [[]];
  const result: T[][] = [values.slice(0, firstSize)];
  for (let index = firstSize; index < values.length; index += nextSize)
    result.push(values.slice(index, index + nextSize));
  return result;
}

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

function stepText(value: RecipeDraftValue['steps'][number]) {
  return [
    value.sectionTitle ? `${value.sectionTitle}:` : '',
    value.body,
    value.durationSeconds === null ? '' : `(${Math.ceil(value.durationSeconds / 60)} мин)`,
  ]
    .filter(Boolean)
    .join(' ');
}

const ELEMENT_GEOMETRY: Record<
  RecipePageBinding,
  readonly [number, number, number, number, RecipePageElement['region']]
> = {
  cover: [8, 42, 84, 24, 'body'],
  title: [8, 6, 84, 18, 'header'],
  description: [8, 25, 84, 10, 'header'],
  meta: [8, 35, 84, 7, 'header'],
  ingredients: [8, 44, 30, 45, 'sidebar'],
  steps: [42, 44, 50, 45, 'body'],
  notes: [10, 18, 80, 68, 'body'],
  source: [8, 92, 40, 4, 'footer'],
  tags: [52, 92, 40, 4, 'footer'],
};

function element(
  pageNumber: number,
  binding: RecipePageBinding,
  sourceStart: number,
  sourceEnd: number,
  continuation: boolean,
): RecipePageElement {
  const geometry = ELEMENT_GEOMETRY[binding];
  return {
    id: `page-${pageNumber}-${binding}`,
    binding,
    region: geometry[4],
    sourceStart,
    sourceEnd,
    continuation,
    x: geometry[0],
    y: geometry[1],
    width: geometry[2],
    height: geometry[3],
    zIndex: 1,
    locked: true,
  };
}

export function buildRecipePageDocument(
  value: RecipeDraftValue,
  options: RecipePageRenderOptions,
): RecipePageRenderModel {
  const ingredients = fragments(
    value.ingredients.filter((item) => item.name.trim()).map(ingredientText),
    INGREDIENT_FRAGMENT_LENGTH,
    'ingredient',
  );
  const steps = fragments(
    value.steps.filter((item) => item.body.trim()).map(stepText),
    STEP_FRAGMENT_LENGTH,
    'step',
  );
  const ingredientPages = groups(ingredients, 6, 8);
  const stepPages = groups(steps, 3, 4);
  const descriptionParts = splitPageText(value.content.description, NARRATIVE_FRAGMENT_LENGTH);
  const noteParts = splitPageText(value.content.notes, NARRATIVE_FRAGMENT_LENGTH);
  const title = value.content.title.trim() || 'Без названия';
  const kicker =
    templateCategoryForLayout(options.layout) === 'drink'
      ? 'Коллекция напитков'
      : 'Домашний рецепт';
  const listPageCount = Math.max(ingredientPages.length, stepPages.length, 1);
  const pages: RecipeRenderedPage[] = [];

  for (let index = 0; index < listPageCount; index++) {
    pages.push({
      id: `page-${pages.length + 1}`,
      number: pages.length + 1,
      kind: index === 0 ? 'opening' : 'continuation',
      title,
      kicker,
      description: index === 0 ? (descriptionParts[0] ?? '') : '',
      ingredients: ingredientPages[index] ?? [],
      steps: stepPages[index] ?? [],
      narrative: '',
      tags: options.tagNames,
      sourceUrl: value.content.sourceUrl,
    });
  }
  for (const narrative of descriptionParts.slice(1))
    pages.push({
      id: `page-${pages.length + 1}`,
      number: pages.length + 1,
      kind: 'story',
      title,
      kicker: 'Продолжение истории',
      description: '',
      ingredients: [],
      steps: [],
      narrative,
      tags: options.tagNames,
      sourceUrl: value.content.sourceUrl,
    });
  for (const narrative of noteParts)
    pages.push({
      id: `page-${pages.length + 1}`,
      number: pages.length + 1,
      kind: 'notes',
      title,
      kicker: 'Заметки к рецепту',
      description: '',
      ingredients: [],
      steps: [],
      narrative,
      tags: options.tagNames,
      sourceUrl: value.content.sourceUrl,
    });

  const document = recipePageDocumentSchema.parse({
    version: RECIPE_PAGE_DOCUMENT_VERSION,
    recipeId: options.recipeId,
    recipeRevision: options.recipeRevision,
    templateId: options.templateId,
    templateRevision: options.templateRevision,
    layout: options.layout,
    pages: pages.map((page, index) => {
      const elements: RecipePageElement[] = [];
      if (page.kind === 'opening') {
        elements.push(element(page.number, 'title', 0, 1, false));
        if (page.description) elements.push(element(page.number, 'description', 0, 1, false));
        elements.push(element(page.number, 'meta', 0, 1, false));
        if (options.hasCover) elements.push(element(page.number, 'cover', 0, 1, false));
      } else elements.push(element(page.number, 'title', 0, 1, true));
      if (page.ingredients.length)
        elements.push(
          element(
            page.number,
            'ingredients',
            page.ingredients[0]?.sourceIndex ?? 0,
            (page.ingredients.at(-1)?.sourceIndex ?? 0) + 1,
            page.kind !== 'opening',
          ),
        );
      if (page.steps.length)
        elements.push(
          element(
            page.number,
            'steps',
            page.steps[0]?.sourceIndex ?? 0,
            (page.steps.at(-1)?.sourceIndex ?? 0) + 1,
            page.kind !== 'opening',
          ),
        );
      if (page.kind === 'story') elements.push(element(page.number, 'description', 0, 1, true));
      if (page.kind === 'notes') elements.push(element(page.number, 'notes', 0, 1, true));
      if (page.sourceUrl) elements.push(element(page.number, 'source', 0, 1, false));
      if (page.tags.length) elements.push(element(page.number, 'tags', 0, page.tags.length, false));
      return {
        id: page.id,
        index,
        kind: page.kind,
        widthMm: 210,
        heightMm: 297,
        elements,
      };
    }),
  });
  const totalMinutes =
    value.content.prepMinutes === null && value.content.cookMinutes === null
      ? null
      : (value.content.prepMinutes ?? 0) + (value.content.cookMinutes ?? 0);
  return {
    document,
    pages,
    totalMinutes,
    servings: value.content.servings,
    hasLongContent: pages.length > 1,
  };
}
