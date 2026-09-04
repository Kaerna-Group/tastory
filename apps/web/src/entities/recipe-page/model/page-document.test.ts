import { describe, expect, it } from 'vitest';
import { buildRecipePageDocument, splitPageText } from './page-document';
import type { RecipeDraftValue } from '@tastory/contracts';

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

describe('recipe page document builder', () => {
  it('creates the same stable default page for an old recipe', () => {
    const first = buildRecipePageDocument(base, options);
    const second = buildRecipePageDocument(base, options);
    expect(first).toEqual(second);
    expect(first.document).toMatchObject({
      version: 1,
      recipeId,
      recipeRevision: 4,
      templateId: null,
      templateRevision: 1,
      layout: 'hearth',
    });
    expect(first.pages).toHaveLength(1);
  });

  it('moves long content to continuation pages without dropping text', () => {
    const longStep = Array.from({ length: 350 }, (_, index) => `слово${index}`).join(' ');
    const value: RecipeDraftValue = {
      ...base,
      content: { ...base.content, description: longStep, notes: longStep },
      ingredients: Array.from({ length: 18 }, (_, index) => ({
        key: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        sectionTitle: '',
        position: index,
        name: `Ингредиент ${index} ${longStep.slice(0, 180)}`,
        quantityValue: null,
        quantityText: '',
        unit: '',
        note: '',
        isOptional: false,
      })),
      steps: Array.from({ length: 12 }, (_, index) => ({
        key: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        sectionTitle: '',
        position: index,
        body: `${index} ${longStep}`,
        durationSeconds: null,
      })),
    };
    const result = buildRecipePageDocument(value, options);
    expect(result.pages.length).toBeGreaterThan(4);
    expect(result.pages.some((page) => page.kind === 'continuation')).toBe(true);
    expect(result.pages.some((page) => page.kind === 'story')).toBe(true);
    expect(result.pages.some((page) => page.kind === 'notes')).toBe(true);
    const stepText = result.pages.flatMap((page) => page.steps.map((item) => item.text)).join(' ');
    for (let index = 0; index < 12; index++) expect(stepText).toContain(`${index} слово0`);
    expect(splitPageText(longStep, 90).join(' ')).toBe(longStep);
  });
});
