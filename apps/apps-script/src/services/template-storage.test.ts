import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPE_THEME,
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
  recipeDesignSchema,
  recipeTemplateSchema,
  templateSchema,
} from '@tastory/contracts';
import { other, timestamp } from '../test-support/journal-fixture';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { publishTemplateMutation, readTemplateState } from './template-storage';
import { encodeRecipeRow } from './recipe-storage';

const now = () => new Date(timestamp);

describe('durable template storage', () => {
  it('publishes once, replays the same request and rejects a changed retry', () => {
    const f = persistenceFixture();
    const requestId = randomUUID();
    const template = templateSchema.parse({
      id: requestId,
      workspaceId: f.context.workspaceId,
      ownerUserId: other,
      kind: 'custom',
      name: 'Семейная страница',
      description: 'Личный шаблон',
      category: 'dish',
      layout: 'notebook',
      visibility: 'private',
      status: 'active',
      sourceTemplateId: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const operation = {
      requestId,
      workspaceId: f.context.workspaceId,
      userId: other,
      action: 'templates.create' as const,
      entityId: template.id,
      payloadHash: 'a'.repeat(64),
      startedAt: timestamp,
    };
    expect(
      publishTemplateMutation(f.store, operation, [{ table: 'Templates', value: template }], now),
    ).toBe('committed');
    expect(
      publishTemplateMutation(f.store, operation, [{ table: 'Templates', value: template }], now),
    ).toBe('replayed');
    expect(readTemplateState(f.store).templates.get(template.id)).toMatchObject({
      name: 'Семейная страница',
    });
    expect(() =>
      publishTemplateMutation(
        f.store,
        { ...operation, payloadHash: 'b'.repeat(64) },
        [{ table: 'Templates', value: template }],
        now,
      ),
    ).toThrow('TEMPLATE_CONFLICT');
  });

  it('stores theme snapshots and reads legacy layouts with the stable default theme', () => {
    const f = persistenceFixture();
    const requestId = randomUUID();
    const recipeId = randomUUID();
    const applied = recipeTemplateSchema.parse({
      id: recipeId,
      recipeId,
      templateId: null,
      templateName: 'Перенесённая страница',
      category: 'dish',
      layout: 'herbarium',
      theme: { ...DEFAULT_RECIPE_THEME, name: 'Лес', paper: 'linen' },
      sourceOwnerUserId: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const operation = {
      requestId,
      workspaceId: f.context.workspaceId,
      userId: other,
      action: 'recipes.template.restore' as const,
      entityId: recipeId,
      payloadHash: 'c'.repeat(64),
      startedAt: timestamp,
    };
    publishTemplateMutation(
      f.store,
      operation,
      [{ table: 'RecipeTemplates', value: applied }],
      now,
    );
    expect(readTemplateState(f.store).applied.get(recipeId)).toMatchObject({
      layout: 'herbarium',
      theme: { name: 'Лес', paper: 'linen' },
    });

    const legacyRequestId = randomUUID();
    const legacyRecipeId = randomUUID();
    f.required('TemplateOperations').push(
      encodeRecipeRow('TemplateOperations', {
        requestId: legacyRequestId,
        workspaceId: f.context.workspaceId,
        userId: other,
        action: 'recipes.template.apply',
        entityId: legacyRecipeId,
        payloadHash: 'd'.repeat(64),
        startedAt: timestamp,
        state: `committed@${timestamp}`,
      }),
    );
    f.required('RecipeTemplates').push(
      encodeRecipeRow('RecipeTemplates', {
        versionId: legacyRequestId,
        id: legacyRecipeId,
        recipeId: legacyRecipeId,
        templateId: randomUUID(),
        templateName: 'Старая страница',
        category: 'dish',
        layout: 'hearth',
        sourceOwnerUserId: null,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    expect(readTemplateState(f.store).applied.get(legacyRecipeId)).toMatchObject({
      layout: 'hearth',
      theme: DEFAULT_RECIPE_THEME,
    });
  });

  it('stores a complete design snapshot once and rejects damaged embedded documents', () => {
    const f = persistenceFixture();
    const requestId = randomUUID();
    const recipeId = randomUUID();
    const design = recipeDesignSchema.parse({
      id: recipeId,
      recipeId,
      revision: 1,
      recipeTemplateRevision: null,
      sourceTemplateId: null,
      sourceTemplateRevision: null,
      value: {
        version: RECIPE_DESIGN_VERSION,
        layout: 'hearth',
        layoutVersion: RECIPE_LAYOUT_VERSION,
        layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
        theme: DEFAULT_RECIPE_THEME,
        elements: [],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const operation = {
      requestId,
      workspaceId: f.context.workspaceId,
      userId: other,
      action: 'recipes.design.save' as const,
      entityId: recipeId,
      payloadHash: 'e'.repeat(64),
      startedAt: timestamp,
    };
    expect(
      publishTemplateMutation(f.store, operation, [{ table: 'RecipeDesigns', value: design }], now),
    ).toBe('committed');
    expect(
      publishTemplateMutation(f.store, operation, [{ table: 'RecipeDesigns', value: design }], now),
    ).toBe('replayed');
    expect(f.required('RecipeDesigns')).toHaveLength(2);
    expect(readTemplateState(f.store).designs.get(recipeId)).toMatchObject({
      revision: 1,
      value: { layout: 'hearth', theme: DEFAULT_RECIPE_THEME },
    });
    const row = f.required('RecipeDesigns')[1];
    if (!row) throw new Error('fixture');
    row[7] = JSON.stringify('{"html":"unsafe"}');
    expect(() => readTemplateState(f.store)).toThrow('TEMPLATE_UNAVAILABLE');
  });

  it('recovers an atomic assignment and design before or after every storage boundary', () => {
    const run = (f: ReturnType<typeof persistenceFixture>, requestId: string, recipeId: string) => {
      const applied = recipeTemplateSchema.parse({
        id: recipeId,
        recipeId,
        templateId: null,
        templateName: 'Целостная страница',
        category: 'dish',
        layout: 'hearth',
        theme: DEFAULT_RECIPE_THEME,
        sourceOwnerUserId: null,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const design = recipeDesignSchema.parse({
        id: recipeId,
        recipeId,
        revision: 1,
        recipeTemplateRevision: 1,
        sourceTemplateId: null,
        sourceTemplateRevision: null,
        value: {
          version: RECIPE_DESIGN_VERSION,
          layout: 'hearth',
          layoutVersion: RECIPE_LAYOUT_VERSION,
          layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
          theme: DEFAULT_RECIPE_THEME,
          elements: [],
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return publishTemplateMutation(
        f.store,
        {
          requestId,
          workspaceId: f.context.workspaceId,
          userId: other,
          action: 'recipes.template.restore',
          entityId: recipeId,
          payloadHash: 'f'.repeat(64),
          startedAt: timestamp,
        },
        [
          { table: 'RecipeTemplates', value: applied },
          { table: 'RecipeDesigns', value: design },
        ],
        now,
      );
    };
    const measured = persistenceFixture();
    run(measured, randomUUID(), randomUUID());
    const boundaries = measured.count();
    for (const after of [false, true])
      for (let index = 1; index <= boundaries; index++) {
        const f = persistenceFixture();
        const requestId = randomUUID();
        const recipeId = randomUUID();
        f.fail(index, after);
        expect(() => run(f, requestId, recipeId)).toThrow();
        f.fail();
        expect(run(f, requestId, recipeId)).toMatch(/committed|replayed/);
        expect(f.required('RecipeTemplates')).toHaveLength(2);
        expect(f.required('RecipeDesigns')).toHaveLength(2);
        const state = readTemplateState(f.store);
        expect(state.applied.get(recipeId)?.revision).toBe(1);
        expect(state.designs.get(recipeId)?.revision).toBe(1);
      }
  });
});
