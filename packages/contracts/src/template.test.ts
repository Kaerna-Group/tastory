import { describe, expect, it } from 'vitest';
import {
  BUILTIN_RECIPE_TEMPLATES,
  DEFAULT_RECIPE_THEME,
  TEMPLATE_API_CAPABILITIES,
  templateCommandSchema,
  templateDataSchema,
  templateSchema,
} from './index';

describe('recipe template contracts', () => {
  it('keeps ten legacy builtins and adds four reference-led dish families', () => {
    expect(BUILTIN_RECIPE_TEMPLATES).toHaveLength(14);
    expect(BUILTIN_RECIPE_TEMPLATES.filter((item) => item.category === 'dish')).toHaveLength(9);
    expect(BUILTIN_RECIPE_TEMPLATES.filter((item) => item.category === 'drink')).toHaveLength(5);
    expect(new Set(BUILTIN_RECIPE_TEMPLATES.map((item) => item.id)).size).toBe(14);
    expect(new Set(BUILTIN_RECIPE_TEMPLATES.map((item) => item.layout)).size).toBe(14);
    expect(BUILTIN_RECIPE_TEMPLATES.map((item) => item.layout)).toEqual(
      expect.arrayContaining(['pastel-notebook', 'berry-diary', 'lined-notebook', 'clean-card']),
    );
    for (const template of BUILTIN_RECIPE_TEMPLATES)
      expect(templateSchema.parse(template)).toEqual(template);
  });

  it('rejects a layout stored under the wrong category', () => {
    expect(
      templateSchema.safeParse({ ...BUILTIN_RECIPE_TEMPLATES[0], category: 'drink' }).success,
    ).toBe(false);
  });

  it('accepts simple personal creation, sharing and copying commands', () => {
    expect(
      templateCommandSchema.parse({
        action: 'templates.create',
        payload: {
          name: 'Мой завтрак',
          description: 'Спокойная утренняя страница',
          layout: 'notebook',
          visibility: 'private',
        },
      }),
    ).toMatchObject({ action: 'templates.create' });
    expect(
      templateCommandSchema.parse({
        action: 'templates.clone',
        payload: { templateId: BUILTIN_RECIPE_TEMPLATES[5]?.id, expectedRevision: 1 },
      }),
    ).toMatchObject({ payload: { visibility: 'private' } });
  });

  it('keeps each library page within the shared response limit', () => {
    expect(
      templateCommandSchema.parse({
        action: 'templates.list',
        payload: { query: '', category: 'all', scope: 'all', includeArchived: false },
      }),
    ).toEqual({
      action: 'templates.list',
      payload: { query: '', category: 'all', scope: 'all', includeArchived: false },
    });
    expect(
      templateCommandSchema.safeParse({
        action: 'templates.list',
        payload: {
          query: '',
          category: 'all',
          scope: 'all',
          includeArchived: false,
          offset: 0,
          limit: 101,
        },
      }).success,
    ).toBe(false);
    const template = BUILTIN_RECIPE_TEMPLATES[0];
    if (!template) throw new Error('fixture');
    const view = {
      template,
      authorName: 'Tastory',
      canManage: false,
      canCopy: true,
    };
    expect(
      templateDataSchema.safeParse({
        kind: 'templateLibrary',
        templates: Array.from({ length: 100 }, () => view),
        nextOffset: 100,
      }).success,
    ).toBe(true);
    expect(
      templateDataSchema.safeParse({
        kind: 'templateLibrary',
        templates: Array.from({ length: 101 }, () => view),
        nextOffset: null,
      }).success,
    ).toBe(false);
    expect(
      templateDataSchema.safeParse({ kind: 'templateLibrary', templates: [view] }).success,
    ).toBe(true);
  });

  it('advertises the safe rolling-upgrade capabilities explicitly', () => {
    expect(templateCommandSchema.parse({ action: 'templates.capabilities', payload: {} })).toEqual({
      action: 'templates.capabilities',
      payload: {},
    });
    expect(templateDataSchema.parse(TEMPLATE_API_CAPABILITIES)).toEqual(TEMPLATE_API_CAPABILITIES);
  });

  it('represents initial and subsequent recipe template applications explicitly', () => {
    const recipeId = '00000000-0000-4000-8000-000000000001';
    const templateId = BUILTIN_RECIPE_TEMPLATES[0]?.id;

    expect(
      templateCommandSchema.parse({
        action: 'recipes.template.apply',
        payload: {
          recipeId,
          templateId,
          expectedRecipeRevision: 4,
          expectedRecipeTemplateRevision: null,
          theme: DEFAULT_RECIPE_THEME,
        },
      }),
    ).toMatchObject({ payload: { expectedRecipeTemplateRevision: null } });
    expect(
      templateCommandSchema.parse({
        action: 'recipes.template.apply',
        payload: {
          recipeId,
          templateId,
          expectedRecipeRevision: 4,
          expectedRecipeTemplateRevision: 2,
          theme: DEFAULT_RECIPE_THEME,
        },
      }),
    ).toMatchObject({ payload: { expectedRecipeTemplateRevision: 2 } });
    expect(
      templateCommandSchema.parse({
        action: 'recipes.template.apply',
        payload: {
          recipeId,
          templateId,
          expectedRecipeRevision: 4,
          theme: DEFAULT_RECIPE_THEME,
        },
      }),
    ).toMatchObject({ payload: { expectedRecipeRevision: 4 } });
    expect(
      templateCommandSchema.parse({
        action: 'recipes.template.restore',
        payload: {
          recipeId,
          expectedRecipeRevision: 4,
          expectedRecipeTemplateRevision: null,
          snapshot: {
            templateName: 'Перенесённая страница',
            category: 'dish',
            layout: 'herbarium',
            theme: DEFAULT_RECIPE_THEME,
          },
        },
      }),
    ).toMatchObject({ action: 'recipes.template.restore' });
  });
});
