import { describe, expect, it } from 'vitest';
import { recipePageDocumentSchema } from './recipe-page';

const document = {
  version: 1,
  recipeId: '20000000-0000-4000-8000-000000000001',
  recipeRevision: 3,
  templateId: null,
  templateRevision: 1,
  layout: 'hearth',
  pages: [
    {
      id: 'page-1',
      index: 0,
      kind: 'opening',
      widthMm: 210,
      heightMm: 297,
      elements: [
        {
          id: 'page-1-title',
          binding: 'title',
          region: 'header',
          sourceStart: 0,
          sourceEnd: 1,
          continuation: false,
          x: 8,
          y: 8,
          width: 84,
          height: 18,
          zIndex: 1,
          locked: true,
        },
      ],
    },
  ],
} as const;

describe('recipe page document', () => {
  it('accepts a stable A4 page bound to recipe content', () => {
    expect(recipePageDocumentSchema.parse(document)).toEqual(document);
  });

  it('rejects geometry outside the page and unordered pages', () => {
    expect(
      recipePageDocumentSchema.safeParse({
        ...document,
        pages: [
          {
            ...document.pages[0],
            index: 1,
            elements: [{ ...document.pages[0].elements[0], x: 80, width: 30 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
