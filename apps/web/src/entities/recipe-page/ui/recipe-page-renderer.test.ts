import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecipePageRenderer } from './recipe-page-renderer';
import type { RecipePageRendererProps } from './recipe-page-renderer';
import { buildRecipePageDocument } from '../model/page-document';

const value = {
  content: {
    title: 'Пирог',
    description: 'Семейный рецепт',
    servings: 6,
    prepMinutes: 20,
    cookMinutes: 40,
    sourceUrl: 'https://example.test/family-pie',
    notes: '',
  },
  ingredients: [],
  steps: [],
  tagIds: [],
} satisfies RecipePageRendererProps['value'];

describe('RecipePageRenderer', () => {
  it('renders page elements at geometry supplied by the page document', () => {
    const props = {
      value,
      recipeId: '20000000-0000-4000-8000-000000000001',
      recipeRevision: 4,
      templateId: null,
      templateRevision: 1,
      templateName: 'Домашняя страница',
      layout: 'hearth' as const,
      tagNames: [],
      stickers: [
        {
          id: 'sticker-1',
          page: 1,
          name: 'Варенье',
          emoji: '🍓',
          source: '/stickers/jam.png',
          x: 8,
          y: 8,
          width: 18,
          height: 18,
          rotation: 5,
          zIndex: 2,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(RecipePageRenderer, props));
    const model = buildRecipePageDocument(value, props);
    const title = model.document.pages[0]?.elements.find((item) => item.binding === 'title');
    const ingredients = model.document.pages[0]?.elements.find(
      (item) => item.binding === 'ingredients',
    );
    if (!title || !ingredients) throw new Error('fixture');

    expect(markup).toContain('data-document-page="page-1"');
    expect(markup).toContain('data-page-element="page-1-title"');
    expect(markup).toContain('data-page-element="page-1-ingredients"');
    expect(markup).toContain(
      `left:${title.x}%;top:${title.y}%;width:${title.width}%;height:${title.height}%;z-index:1`,
    );
    expect(markup).toContain(
      `left:${ingredients.x}%;top:${ingredients.y}%;width:${ingredients.width}%;height:${ingredients.height}%;z-index:1`,
    );
    expect(markup).toContain('href="https://example.test/family-pie"');
    expect(markup).toContain('Источник рецепта · example.test</a>');
    expect(markup).toContain('data-source-key="description"');
    expect(markup).toContain('data-source-start="0"');
    expect(markup).toContain('data-source-end="15"');
    expect(markup).toContain('data-page-sticker="sticker-1"');
    expect(markup).toContain('transform:rotate(5deg)');

    const bistro = renderToStaticMarkup(
      createElement(RecipePageRenderer, { ...props, layout: 'bistro' }),
    );
    expect(markup).toContain('style="left:8%;top:6%');
    expect(bistro).toContain('style="left:24%;top:6%');

    const designElementId = '60000000-0000-4000-8000-000000000001';
    const authored = renderToStaticMarkup(
      createElement(RecipePageRenderer, {
        ...props,
        designElements: [
          {
            id: designElementId,
            binding: 'title',
            region: 'header',
            x: 12,
            y: 9,
            width: 70,
            height: 18,
            rotation: 3,
            zIndex: 4,
            locked: true,
          },
        ],
      }),
    );
    expect(authored).toContain(`data-design-element="${designElementId}"`);
    expect(authored).toContain('data-composition-key="content:title"');
    expect(authored).toContain('data-composition-kind="content"');
    expect(authored).toContain(
      'style="left:12%;top:9%;width:70%;height:18%;z-index:4;transform:rotate(3deg)"',
    );
  });
});
