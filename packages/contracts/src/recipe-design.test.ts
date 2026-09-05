import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE_THEME } from './template';
import {
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
  recipeDesignValueSchema,
} from './recipe-design';

const element = () => ({
  id: '11111111-1111-4111-8111-111111111111',
  binding: 'notes' as const,
  region: 'body' as const,
  x: 10,
  y: 70,
  width: 80,
  height: 15,
  rotation: 0,
  zIndex: 2,
  locked: true,
});
const value = () => ({
  version: RECIPE_DESIGN_VERSION,
  layout: 'hearth' as const,
  layoutVersion: RECIPE_LAYOUT_VERSION,
  layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
  theme: DEFAULT_RECIPE_THEME,
  elements: [element()],
});

describe('recipe design contract', () => {
  it('keeps author data independent from recipe and measured DOM revisions', () => {
    expect(recipeDesignValueSchema.parse(value())).toMatchObject({
      version: 1,
      layoutVersion: 1,
      layoutAlgorithmVersion: 1,
      elements: [{ binding: 'notes' }],
    });
    expect(() => recipeDesignValueSchema.parse({ ...value(), recipeRevision: 4 })).toThrow();
    expect(() =>
      recipeDesignValueSchema.parse({ ...value(), html: '<main>unsafe</main>' }),
    ).toThrow();
  });

  it('rejects non-finite and out-of-page geometry plus duplicate stable identities', () => {
    const first = element();
    expect(() =>
      recipeDesignValueSchema.parse({
        ...value(),
        elements: [{ ...first, x: Number.POSITIVE_INFINITY }],
      }),
    ).toThrow();
    expect(() =>
      recipeDesignValueSchema.parse({ ...value(), elements: [{ ...first, x: 90, width: 20 }] }),
    ).toThrow();
    expect(() =>
      recipeDesignValueSchema.parse({ ...value(), elements: [first, { ...first }] }),
    ).toThrow();
  });
});
