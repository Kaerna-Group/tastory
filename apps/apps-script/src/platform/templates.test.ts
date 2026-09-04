import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_RECIPE_TEMPLATES } from '@tastory/contracts';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { other, timestamp } from '../test-support/journal-fixture';
import { recipes } from './recipes';
import { templates } from './templates';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  return persistenceFixture();
}

describe('recipe template platform', () => {
  it('lists five dish and five drink builtins', () => {
    const f = setup();
    const all = templates(
      {
        action: 'templates.list',
        payload: { query: '', category: 'all', scope: 'all', includeArchived: false },
      },
      randomUUID(),
      f.context.session,
    );
    if (all.kind !== 'templateLibrary') throw new Error('fixture');
    expect(all.templates).toHaveLength(10);
    expect(all.templates.filter((item) => item.template.category === 'dish')).toHaveLength(5);
    expect(all.templates.filter((item) => item.template.category === 'drink')).toHaveLength(5);
  });

  it('hides a private custom template from viewers while the workspace owner can inspect it', () => {
    const f = setup();
    const templateId = randomUUID();
    templates(
      {
        action: 'templates.create',
        payload: {
          name: 'Личный завтрак',
          description: 'Тихая утренняя страница',
          layout: 'notebook',
          visibility: 'private',
        },
      },
      templateId,
      f.context.session,
    );
    f.context.session.user.id = 'viewer-sub';
    const viewer = templates(
      {
        action: 'templates.list',
        payload: { query: '', category: 'all', scope: 'all', includeArchived: true },
      },
      randomUUID(),
      f.context.session,
    );
    expect(
      viewer.kind === 'templateLibrary' &&
        viewer.templates.some((item) => item.template.id === templateId),
    ).toBe(false);
    f.context.session.user.id = 'owner-sub';
    const owner = templates(
      {
        action: 'templates.list',
        payload: { query: 'личный', category: 'all', scope: 'all', includeArchived: true },
      },
      randomUUID(),
      f.context.session,
    );
    expect(owner).toMatchObject({
      kind: 'templateLibrary',
      templates: [expect.objectContaining({ canManage: true })],
    });
  });

  it('copies another member shared template into an independent personal library item', () => {
    const f = setup();
    f.context.session.user.id = 'owner-sub';
    const sharedId = randomUUID();
    templates(
      {
        action: 'templates.create',
        payload: {
          name: 'Общий ужин',
          description: 'Праздничная подача',
          layout: 'celebration',
          visibility: 'workspace',
        },
      },
      sharedId,
      f.context.session,
    );
    f.context.session.user.id = 'author-sub';
    const community = templates(
      {
        action: 'templates.list',
        payload: { query: '', category: 'all', scope: 'community', includeArchived: false },
      },
      randomUUID(),
      f.context.session,
    );
    expect(community).toMatchObject({
      kind: 'templateLibrary',
      templates: [expect.objectContaining({ canCopy: true })],
    });
    const copyId = randomUUID();
    const copy = templates(
      {
        action: 'templates.clone',
        payload: { templateId: sharedId, expectedRevision: 1, visibility: 'private' },
      },
      copyId,
      f.context.session,
    );
    expect(copy).toMatchObject({
      kind: 'template',
      outcome: 'committed',
      template: {
        id: copyId,
        ownerUserId: other,
        visibility: 'private',
        sourceTemplateId: sharedId,
        layout: 'celebration',
      },
    });
    expect(
      templates(
        {
          action: 'templates.clone',
          payload: { templateId: sharedId, expectedRevision: 1, visibility: 'private' },
        },
        copyId,
        f.context.session,
      ),
    ).toMatchObject({ kind: 'template', outcome: 'replayed', template: { id: copyId } });
  });

  it('applies a snapshot that stays unchanged when its custom source changes', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const templateId = randomUUID();
    templates(
      {
        action: 'templates.create',
        payload: {
          name: 'Мой очаг',
          description: 'Тёплая страница',
          layout: 'hearth',
          visibility: 'private',
        },
      },
      templateId,
      f.context.session,
    );
    const applyId = randomUUID();
    const applyCommand = {
      action: 'recipes.template.apply' as const,
      payload: {
        recipeId: saved.entityId,
        expectedRecipeRevision: saved.revision,
        templateId,
      },
    };
    templates(applyCommand, applyId, f.context.session);
    const updateId = randomUUID();
    const updateCommand = {
      action: 'templates.update' as const,
      payload: {
        templateId,
        expectedRevision: 1,
        name: 'Мой бар',
        description: 'Яркая страница',
        layout: 'fresh-bar' as const,
        visibility: 'private' as const,
      },
    };
    templates(updateCommand, updateId, f.context.session);
    expect(templates(updateCommand, updateId, f.context.session)).toMatchObject({
      kind: 'template',
      outcome: 'replayed',
      template: { name: 'Мой бар', revision: 2 },
    });
    expect(templates(applyCommand, applyId, f.context.session)).toMatchObject({
      kind: 'recipeTemplate',
      outcome: 'replayed',
      template: { templateName: 'Мой очаг', layout: 'hearth' },
    });
    const applied = templates(
      {
        action: 'recipes.template.get',
        payload: { recipeId: saved.entityId },
      },
      randomUUID(),
      f.context.session,
    );
    expect(applied).toMatchObject({
      kind: 'recipeTemplate',
      template: { templateId, templateName: 'Мой очаг', layout: 'hearth' },
    });
    expect(BUILTIN_RECIPE_TEMPLATES).toHaveLength(10);
  });
});
