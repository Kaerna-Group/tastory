import { describe, expect, it } from 'vitest';
import { BUILTIN_RECIPE_TEMPLATES, templateCommandSchema, templateSchema } from './index';

describe('recipe template contracts', () => {
  it('ships ten stable builtins split evenly between dishes and drinks', () => {
    expect(BUILTIN_RECIPE_TEMPLATES).toHaveLength(10);
    expect(BUILTIN_RECIPE_TEMPLATES.filter((item) => item.category === 'dish')).toHaveLength(5);
    expect(BUILTIN_RECIPE_TEMPLATES.filter((item) => item.category === 'drink')).toHaveLength(5);
    expect(new Set(BUILTIN_RECIPE_TEMPLATES.map((item) => item.id)).size).toBe(10);
    expect(new Set(BUILTIN_RECIPE_TEMPLATES.map((item) => item.layout)).size).toBe(10);
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
});
