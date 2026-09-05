import { describe, expect, it } from 'vitest';
import { BUILTIN_RECIPE_TEMPLATES } from '@tastory/contracts';
import type { RecipeDraftValue } from '@tastory/contracts';
import { buildRecipePageDocument } from './page-document';
import type {
  RecipePageFragment,
  RecipePageMeasurer,
  RecipePageRenderOptions,
} from './page-document';

const recipeId = '20000000-0000-4000-8000-000000000001';
const base: RecipeDraftValue = {
  content: {
    title: 'Пирог',
    description: 'Семейный рецепт',
    servings: 6,
    prepMinutes: 20,
    cookMinutes: 40,
    sourceUrl: '',
    notes: '',
  },
  ingredients: [],
  steps: [],
  tagIds: [],
};
const options = {
  recipeId,
  recipeRevision: 4,
  templateId: null,
  templateRevision: 1,
  templateName: 'Домашняя страница',
  layout: 'hearth' as const,
  tagNames: ['Выпечка'],
};

it('preserves exact step seconds and rejects unsafe draft source links', () => {
  const value = {
    ...base,
    content: { ...base.content, sourceUrl: 'javascript:alert(1)' },
    steps: [30, 60, 90, 0].map((durationSeconds, index) => ({
      key: `step-${index}`,
      position: index,
      body: 'Готовьте.',
      sectionTitle: '',
      durationSeconds,
    })),
  };
  const model = buildRecipePageDocument(value, options);
  expect(model.content.steps.map((step) => step.text)).toEqual([
    'Готовьте. (30 сек)',
    'Готовьте. (1 мин)',
    'Готовьте. (1 мин 30 сек)',
    'Готовьте. (0 сек)',
  ]);
  expect(model.content.sourceUrl).toBe('');
  expect(
    model.document.pages
      .flatMap((page) => page.elements)
      .some((element) => element.binding === 'source'),
  ).toBe(false);
});

const lines = (text: string, width: number, characterWidth: number) =>
  text
    .split('\n')
    .reduce(
      (total, paragraph) =>
        total + Math.max(1, Math.ceil(paragraph.length / Math.max(1, width / characterWidth))),
      0,
    );
const measured: RecipePageMeasurer = {
  mode: 'measured',
  pageWidthPx: 800,
  pageHeightPx: 1100,
  gapPx: 10,
  measure(kind, text, width) {
    if (kind === 'opening-title') return 28 + lines(text, width, 20) * 52;
    if (kind === 'continuation-title') return 62;
    if (kind === 'meta') return 44;
    if (kind === 'description') return lines(text, width, 8) * 25;
    if (kind === 'story' || kind === 'notes') return lines(text, width, 10) * 34;
    return 34 + (text ? lines(text, width - 32, 8) * 21 : 0);
  },
};

it('paginates protected step/gallery photos without moving existing text pages or duplicating assets', () => {
  const value = {
    ...base,
    steps: [
      {
        key: 'step-a',
        position: 0,
        body: 'Приготовьте блюдо.',
        sectionTitle: '',
        durationSeconds: null,
      },
    ],
  };
  const original = buildRecipePageDocument(value, options, measured);
  const photos = [
    {
      id: 'photo-gallery',
      kind: 'gallery' as const,
      stepId: null,
      position: 0,
      source: 'blob:gallery',
    },
    { id: 'photo-step', kind: 'step' as const, stepId: 'step-a', position: 0, source: 'blob:step' },
  ];
  for (const template of BUILTIN_RECIPE_TEMPLATES) {
    const model = buildRecipePageDocument(
      value,
      { ...options, layout: template.layout, photos },
      measured,
    );
    expect(model.overflow).toBe(false);
    expect(model.content.photos.map((photo) => photo.id)).toEqual(['photo-step', 'photo-gallery']);
    expect(model.content.photos[0]?.caption).toBe('Шаг 1 · фото 1');
    const blocks = model.document.pages.flatMap((page) =>
      page.elements.filter((element) => element.binding === 'photos'),
    );
    expect(blocks.map((block) => [block.sourceStart, block.sourceEnd])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(blocks.every((block) => block.y + block.height <= 100)).toBe(true);
  }
  const withPhotos = buildRecipePageDocument(value, { ...options, photos }, measured);
  expect(withPhotos.document.pages.slice(0, original.document.pages.length)).toEqual(
    original.document.pages,
  );
  expect(
    buildRecipePageDocument({ ...value, steps: [] }, { ...options, photos }, measured).overflow,
  ).toBe(true);
});

const ingredient = (key: string, position: number, name: string) => ({
  key,
  sectionTitle: '',
  position,
  name,
  quantityValue: null,
  quantityText: '',
  unit: '',
  note: '',
  isOptional: false,
});
const step = (key: string, position: number, body: string) => ({
  key,
  sectionTitle: '',
  position,
  body,
  durationSeconds: null,
});

function expectExactSource(fragments: readonly RecipePageFragment[], key: string, source: string) {
  const selected = fragments.filter((item) => item.sourceKey === key);
  expect(selected.map((item) => item.text).join('')).toBe(source);
  expect(selected[0]?.sourceStart).toBe(0);
  expect(selected.at(-1)?.sourceEnd).toBe(source.length);
  selected.slice(1).forEach((item, index) => {
    expect(item.sourceStart).toBe(selected[index]?.sourceEnd);
    expect(item.partIndex).toBe(index + 1);
    expect(item.continuation).toBe(true);
  });
}

describe('recipe page measured document', () => {
  it('keeps author design separate from a deterministic computed document for all layouts', () => {
    expect(BUILTIN_RECIPE_TEMPLATES).toHaveLength(14);
    for (const template of BUILTIN_RECIPE_TEMPLATES) {
      const input = { ...options, layout: template.layout, templateId: template.id };
      const first = buildRecipePageDocument(base, input, measured);
      const second = buildRecipePageDocument(base, input, measured);
      expect(first).toEqual(second);
      expect(first.design).toMatchObject({
        layout: template.layout,
        pageWidthMm: 210,
        pageHeightMm: 297,
      });
      expect(first.document).toMatchObject({
        version: 1,
        layout: template.layout,
        recipeRevision: 4,
      });
      expect(first.measurement).toBe('measured');
      for (const page of first.document.pages)
        for (const element of page.elements) {
          expect(element.x + element.width).toBeLessThanOrEqual(100);
          expect(element.y + element.height).toBeLessThanOrEqual(100);
        }
    }
  });

  it('uses distinct reference-led geometry without changing legacy layout identities', () => {
    const byLayout = (layout: RecipePageRenderOptions['layout']) =>
      buildRecipePageDocument(base, { ...options, layout, hasCover: true }, measured).design;
    const pastel = byLayout('pastel-notebook');
    const berry = byLayout('berry-diary');
    const lined = byLayout('lined-notebook');
    const clean = byLayout('clean-card');

    expect(pastel.coverPlacement).toBe('banner');
    expect(berry.coverPlacement).toBe('side');
    expect(lined.coverPlacement).toBe('side');
    expect(clean.coverPlacement).toBe('banner');
    expect(
      new Set([pastel.sidebarWidth, berry.sidebarWidth, lined.sidebarWidth, clean.sidebarWidth])
        .size,
    ).toBeGreaterThan(2);
    expect(byLayout('hearth')).toMatchObject({ frameX: 8, frameWidth: 84 });
    expect(byLayout('wine-cellar')).toMatchObject({ frameX: 14, frameWidth: 72 });
  });

  it('preserves stable source keys and original indexes when empty rows are filtered', () => {
    const firstKey = '30000000-0000-4000-8000-000000000001';
    const emptyKey = '30000000-0000-4000-8000-000000000002';
    const thirdKey = '30000000-0000-4000-8000-000000000003';
    const stepKey = '40000000-0000-4000-8000-000000000002';
    const result = buildRecipePageDocument(
      {
        ...base,
        ingredients: [
          ingredient(firstKey, 0, 'Мука'),
          ingredient(emptyKey, 1, '   '),
          ingredient(thirdKey, 2, 'Яблоки'),
        ],
        steps: [step('40000000-0000-4000-8000-000000000001', 0, ''), step(stepKey, 1, 'Испечь')],
      },
      options,
      measured,
    );
    expect(result.content.ingredients.map((item) => [item.sourceKey, item.sourceIndex])).toEqual([
      [firstKey, 0],
      [thirdKey, 2],
    ]);
    expect(result.content.steps.map((item) => [item.sourceKey, item.sourceIndex])).toEqual([
      [stepKey, 1],
    ]);
  });

  it('keeps exact ranges, paragraphs and one document binding for every long fragment', () => {
    const ingredientKey = '30000000-0000-4000-8000-000000000001';
    const stepKey = '40000000-0000-4000-8000-000000000001';
    const longIngredient = 'Очень длинный ингредиент '.repeat(80);
    const longStep =
      '🍰 Первый абзац шага. '.repeat(90) + '\n\n' + 'Второй абзац шага. '.repeat(90);
    const description = 'История первая. '.repeat(80) + '\n\n' + 'История вторая. '.repeat(80);
    const notes = 'Строка заметок.\n'.repeat(180);
    const result = buildRecipePageDocument(
      {
        ...base,
        content: { ...base.content, description, notes },
        ingredients: [ingredient(ingredientKey, 0, longIngredient)],
        steps: [step(stepKey, 0, longStep)],
      },
      options,
      measured,
    );
    expect(result.document.pages.length).toBeGreaterThan(4);
    expectExactSource(result.content.ingredients, ingredientKey, longIngredient);
    expectExactSource(result.content.steps, stepKey, longStep);
    expectExactSource(result.content.description, 'description', description);
    expectExactSource(result.content.notes, 'notes', notes);

    for (const binding of ['description', 'ingredients', 'steps', 'notes'] as const) {
      const rendered = result.document.pages.flatMap((page) =>
        page.elements
          .filter((element) => element.binding === binding)
          .flatMap((element) =>
            result.content[binding]
              .slice(element.sourceStart, element.sourceEnd)
              .map((item) => item.fragmentIndex),
          ),
      );
      expect(rendered).toEqual(result.content[binding].map((item) => item.fragmentIndex));
    }
  });

  it('uses measured title and cover geometry before calculating list capacity', () => {
    const rows = Array.from({ length: 18 }, (_, index) =>
      ingredient(
        `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        index,
        `Продукт ${index}`,
      ),
    );
    const short = buildRecipePageDocument({ ...base, ingredients: rows }, options, measured);
    const longTitle = buildRecipePageDocument(
      {
        ...base,
        content: { ...base.content, title: 'Очень длинное семейное название '.repeat(8) },
        ingredients: rows,
      },
      { ...options, hasCover: true },
      measured,
    );
    const shortTitle = short.document.pages[0]?.elements.find((item) => item.binding === 'title');
    const longTitleElement = longTitle.document.pages[0]?.elements.find(
      (item) => item.binding === 'title',
    );
    const cover = longTitle.document.pages[0]?.elements.find((item) => item.binding === 'cover');
    const flow = longTitle.document.pages[0]?.elements.find(
      (item) => item.binding === 'ingredients',
    );
    expect((longTitleElement?.height ?? 0) > (shortTitle?.height ?? 0)).toBe(true);
    expect(cover && flow && cover.y + cover.height <= flow.y).toBe(true);
    expect(
      longTitle.content.ingredients.filter((item) => item.fragmentIndex < (flow?.sourceEnd ?? 0))
        .length,
    ).toBeLessThan(
      short.content.ingredients.filter(
        (item) =>
          item.fragmentIndex <
          (short.document.pages[0]?.elements.find((entry) => entry.binding === 'ingredients')
            ?.sourceEnd ?? 0),
      ).length,
    );
  });

  it('returns a valid blocked layout instead of shrinking an impossible title', () => {
    const result = buildRecipePageDocument(
      { ...base, content: { ...base.content, title: 'ОченьДлинноеНазвание'.repeat(100) } },
      options,
      measured,
    );
    expect(result.overflow).toBe(true);
    expect(
      result.document.pages[0]?.elements.find((item) => item.binding === 'title')?.height,
    ).toBe(45);
  });

  it('paginates boundary-sized lists without losing or repeating a source', () => {
    const ingredients = Array.from({ length: 100 }, (_, index) =>
      ingredient(
        `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        index,
        `Ингредиент ${index}`,
      ),
    );
    const steps = Array.from({ length: 100 }, (_, index) =>
      step(
        `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        index,
        `Шаг ${index}. Подробное действие.`,
      ),
    );
    const result = buildRecipePageDocument({ ...base, ingredients, steps }, options, measured);
    expect(result.overflow).toBe(false);
    expect(new Set(result.content.ingredients.map((item) => item.sourceKey))).toHaveLength(100);
    expect(new Set(result.content.steps.map((item) => item.sourceKey))).toHaveLength(100);
    expect(result.content.ingredients.map((item) => item.text).join('')).toContain('Ингредиент 99');
    expect(result.content.steps.map((item) => item.text).join('')).toContain('Шаг 99');
  });
});
