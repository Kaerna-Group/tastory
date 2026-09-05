import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_RECIPE_TEMPLATES,
  DEFAULT_RECIPE_THEME,
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
  TEMPLATE_API_CAPABILITIES,
  templateDataSchema,
  templateSchema,
} from '@tastory/contracts';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { other, timestamp, workspace } from '../test-support/journal-fixture';
import { recipes } from './recipes';
import { templates } from './templates';
import { encodeRecipeRow } from '../services/recipe-storage';

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
  it('advertises template API v3 before clients send durable design fields', () => {
    const f = setup();
    expect(
      templates({ action: 'templates.capabilities', payload: {} }, randomUUID(), f.context.session),
    ).toEqual(TEMPLATE_API_CAPABILITIES);
  });

  it('publishes one durable design, replays a lost response and conflicts two clients', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const source = BUILTIN_RECIPE_TEMPLATES[0];
    if (!source) throw new Error('fixture');
    const value = {
      version: RECIPE_DESIGN_VERSION,
      layout: source.layout,
      layoutVersion: RECIPE_LAYOUT_VERSION,
      layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
      theme: { ...DEFAULT_RECIPE_THEME, name: 'Сохранённая бумага', paper: 'linen' as const },
      elements: [
        {
          id: randomUUID(),
          binding: 'notes' as const,
          region: 'body' as const,
          x: 10,
          y: 70,
          width: 80,
          height: 15,
          rotation: 0,
          zIndex: 2,
          locked: true,
        },
      ],
    };
    const apply = {
      action: 'recipes.template.apply' as const,
      payload: {
        recipeId: saved.entityId,
        expectedRecipeRevision: 1,
        expectedRecipeTemplateRevision: null,
        expectedRecipeDesignRevision: null,
        templateId: source.id,
        theme: value.theme,
        design: value,
      },
    };
    const requestId = randomUUID();
    expect(templates(apply, requestId, f.context.session)).toMatchObject({
      kind: 'recipeTemplate',
      outcome: 'committed',
    });
    expect(templates(apply, requestId, f.context.session)).toMatchObject({
      outcome: 'replayed',
    });
    expect(
      templates(
        { action: 'recipes.design.get', payload: { recipeId: saved.entityId } },
        randomUUID(),
        f.context.session,
      ),
    ).toMatchObject({
      kind: 'recipeDesign',
      outcome: 'read',
      design: {
        revision: 1,
        recipeTemplateRevision: 1,
        sourceTemplateId: source.id,
        sourceTemplateRevision: source.revision,
        value,
      },
    });

    const contentUpdate = recipes(
      {
        action: 'recipes.updateContent',
        payload: {
          recipeId: saved.entityId,
          expectedRevision: 1,
          value: { ...f.value, content: { ...f.value.content, title: 'Новый текст' } },
        },
      },
      randomUUID(),
      f.context.session,
    );
    expect(contentUpdate).toMatchObject({ kind: 'saved', revision: 2 });

    const firstSave = {
      action: 'recipes.design.save' as const,
      payload: {
        recipeId: saved.entityId,
        expectedRevision: 1,
        value: { ...value, theme: { ...value.theme, name: 'Клиент А' } },
      },
    };
    expect(templates(firstSave, randomUUID(), f.context.session)).toMatchObject({
      kind: 'recipeDesign',
      outcome: 'committed',
      design: { revision: 2, value: { theme: { name: 'Клиент А' } } },
    });
    expect(() =>
      templates(
        {
          action: 'recipes.design.save',
          payload: {
            recipeId: saved.entityId,
            expectedRevision: 1,
            value: { ...value, theme: { ...value.theme, name: 'Клиент Б' } },
          },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('TEMPLATE_CONFLICT');

    const viewerSession = {
      ...f.context.session,
      user: { ...f.context.session.user, id: 'viewer-sub', role: 'viewer' as const },
    };
    expect(
      templates(
        { action: 'recipes.design.get', payload: { recipeId: saved.entityId } },
        randomUUID(),
        viewerSession,
      ),
    ).toMatchObject({ kind: 'recipeDesign', design: { revision: 2 } });
    expect(() => templates(firstSave, randomUUID(), viewerSession)).toThrowError('ACCESS_DENIED');
  });

  it('lists ten legacy builtins plus four reference-led dish families', () => {
    const f = setup();
    const all = templates(
      {
        action: 'templates.list',
        payload: {
          query: '',
          category: 'all',
          scope: 'all',
          includeArchived: false,
          offset: 0,
          limit: 100,
        },
      },
      randomUUID(),
      f.context.session,
    );
    if (all.kind !== 'templateLibrary') throw new Error('fixture');
    expect(all.templates).toHaveLength(14);
    expect(all.templates.filter((item) => item.template.category === 'dish')).toHaveLength(9);
    expect(all.templates.filter((item) => item.template.category === 'drink')).toHaveLength(5);
  });

  it('reads an old recipe as an unsaved fallback without creating a design row', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const before = structuredClone(f.required('RecipeDesigns'));
    expect(
      templates(
        { action: 'recipes.design.get', payload: { recipeId: saved.entityId } },
        randomUUID(),
        f.context.session,
      ),
    ).toEqual({
      kind: 'recipeDesign',
      recipeId: saved.entityId,
      design: null,
      outcome: 'read',
    });
    expect(f.required('RecipeDesigns')).toEqual(before);
  });

  it('paginates more than one hundred accessible templates without losing entries', () => {
    const f = setup();
    for (let index = 0; index < 101; index++) {
      const requestId = randomUUID();
      const template = templateSchema.parse({
        id: randomUUID(),
        workspaceId: f.context.workspaceId,
        ownerUserId: randomUUID(),
        kind: 'custom',
        name: `Общий шаблон ${String(index).padStart(3, '0')}`,
        description: '',
        category: 'dish',
        layout: 'hearth',
        visibility: 'workspace',
        status: 'active',
        sourceTemplateId: null,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      f.required('TemplateOperations').push(
        encodeRecipeRow('TemplateOperations', {
          requestId,
          workspaceId: f.context.workspaceId,
          userId: other,
          action: 'templates.create',
          entityId: template.id,
          payloadHash: index.toString(16).padStart(64, '0'),
          startedAt: timestamp,
          state: `committed@${timestamp}`,
        }),
      );
      f.required('Templates').push(
        encodeRecipeRow('Templates', { versionId: requestId, ...template }),
      );
    }
    const page = (offset: number) =>
      templates(
        {
          action: 'templates.list',
          payload: {
            query: '',
            category: 'all',
            scope: 'all',
            includeArchived: false,
            offset,
            limit: 100,
          },
        },
        randomUUID(),
        f.context.session,
      );
    const first = templateDataSchema.parse(page(0));
    if (first.kind !== 'templateLibrary') throw new Error('fixture');
    expect(first.templates).toHaveLength(100);
    expect(first.nextOffset).toBe(100);
    const second = templateDataSchema.parse(page(first.nextOffset ?? 0));
    if (second.kind !== 'templateLibrary') throw new Error('fixture');
    expect(second.templates).toHaveLength(15);
    expect(second.nextOffset).toBeNull();
    const ids = [...first.templates, ...second.templates].map((item) => item.template.id);
    expect(new Set(ids)).toHaveLength(115);
    expect(() =>
      templates(
        {
          action: 'templates.list',
          payload: {
            query: '',
            category: 'all',
            scope: 'all',
            includeArchived: false,
          },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('TEMPLATE_LIMIT');
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
        payload: {
          query: '',
          category: 'all',
          scope: 'all',
          includeArchived: true,
          offset: 0,
          limit: 100,
        },
      },
      randomUUID(),
      f.context.session,
    );
    expect(
      viewer.kind === 'templateLibrary' &&
        viewer.templates.some((item) => item.template.id === templateId),
    ).toBe(false);
    expect(() =>
      templates(
        {
          action: 'templates.create',
          payload: {
            name: 'Запрещённый шаблон',
            description: '',
            layout: 'hearth',
            visibility: 'private',
          },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('ACCESS_DENIED');

    const memberId = randomUUID();
    f.required('Users').push([
      memberId,
      'member-sub',
      'member@example.test',
      'member@example.test',
      'Member',
      '',
      'active',
      timestamp,
      '',
      '1',
    ]);
    f.required('WorkspaceMembers').push([workspace, memberId, 'member', 'active', timestamp, '1']);
    f.context.session.user.id = 'member-sub';
    expect(() =>
      templates(
        {
          action: 'templates.clone',
          payload: { templateId, expectedRevision: 1, visibility: 'private' },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('ACCESS_DENIED');

    f.context.session.user.id = 'owner-sub';
    const owner = templates(
      {
        action: 'templates.list',
        payload: {
          query: 'личный',
          category: 'all',
          scope: 'all',
          includeArchived: true,
          offset: 0,
          limit: 100,
        },
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
        payload: {
          query: '',
          category: 'all',
          scope: 'community',
          includeArchived: false,
          offset: 0,
          limit: 100,
        },
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
        expectedRecipeRevision: 1,
        expectedRecipeTemplateRevision: null,
        templateId,
        theme: DEFAULT_RECIPE_THEME,
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
    expect(BUILTIN_RECIPE_TEMPLATES).toHaveLength(14);
  });

  it('rejects two clients applying different layouts with the same presentation revision', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const firstTemplate = BUILTIN_RECIPE_TEMPLATES[0];
    const secondTemplate = BUILTIN_RECIPE_TEMPLATES[1];
    if (!firstTemplate || !secondTemplate) throw new Error('fixture');

    const initiallyApplied = templates(
      {
        action: 'recipes.template.apply',
        payload: {
          recipeId: saved.entityId,
          expectedRecipeRevision: 1,
          expectedRecipeTemplateRevision: null,
          templateId: firstTemplate.id,
          theme: DEFAULT_RECIPE_THEME,
        },
      },
      randomUUID(),
      f.context.session,
    );
    expect(initiallyApplied).toMatchObject({
      kind: 'recipeTemplate',
      template: { templateId: firstTemplate.id, revision: 1 },
    });

    expect(() =>
      templates(
        {
          action: 'recipes.template.apply',
          payload: {
            recipeId: saved.entityId,
            expectedRecipeRevision: 1,
            expectedRecipeTemplateRevision: null,
            templateId: secondTemplate.id,
            theme: DEFAULT_RECIPE_THEME,
          },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('TEMPLATE_CONFLICT');

    const reapplied = templates(
      {
        action: 'recipes.template.apply',
        payload: {
          recipeId: saved.entityId,
          expectedRecipeRevision: 1,
          expectedRecipeTemplateRevision: 1,
          templateId: secondTemplate.id,
          theme: DEFAULT_RECIPE_THEME,
        },
      },
      randomUUID(),
      f.context.session,
    );
    expect(reapplied).toMatchObject({
      kind: 'recipeTemplate',
      template: { templateId: secondTemplate.id, revision: 2 },
    });
  });

  it('keeps recipe content revision checks and permits legacy apply only before first use', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const firstTemplate = BUILTIN_RECIPE_TEMPLATES[0];
    const secondTemplate = BUILTIN_RECIPE_TEMPLATES[1];
    if (!firstTemplate || !secondTemplate) throw new Error('fixture');

    expect(() =>
      templates(
        {
          action: 'recipes.template.apply',
          payload: {
            recipeId: saved.entityId,
            expectedRecipeRevision: 2,
            expectedRecipeTemplateRevision: null,
            templateId: firstTemplate.id,
            theme: DEFAULT_RECIPE_THEME,
          },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('TEMPLATE_CONFLICT');

    templates(
      {
        action: 'recipes.template.apply',
        payload: {
          recipeId: saved.entityId,
          expectedRecipeRevision: 1,
          templateId: firstTemplate.id,
          theme: DEFAULT_RECIPE_THEME,
        },
      },
      randomUUID(),
      f.context.session,
    );
    expect(() =>
      templates(
        {
          action: 'recipes.template.apply',
          payload: {
            recipeId: saved.entityId,
            expectedRecipeRevision: 1,
            templateId: secondTemplate.id,
            theme: DEFAULT_RECIPE_THEME,
          },
        },
        randomUUID(),
        f.context.session,
      ),
    ).toThrowError('TEMPLATE_CONFLICT');
  });

  it('rejects a repeated request id when the payload changes', () => {
    const f = setup();
    const requestId = randomUUID();
    const create = (name: string) => ({
      action: 'templates.create' as const,
      payload: {
        name,
        description: '',
        layout: 'hearth' as const,
        visibility: 'private' as const,
      },
    });
    expect(templates(create('Завтрак'), requestId, f.context.session)).toMatchObject({
      outcome: 'committed',
    });
    expect(() => templates(create('Ужин'), requestId, f.context.session)).toThrowError(
      'TEMPLATE_CONFLICT',
    );
  });

  it('restores a portable presentation without the source template', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const command = {
      action: 'recipes.template.restore' as const,
      payload: {
        recipeId: saved.entityId,
        expectedRecipeRevision: 1,
        expectedRecipeTemplateRevision: null,
        snapshot: {
          templateName: 'Перенесённый гербарий',
          category: 'dish' as const,
          layout: 'herbarium' as const,
          theme: {
            ...DEFAULT_RECIPE_THEME,
            name: 'Лесная бумага',
            palette: { ...DEFAULT_RECIPE_THEME.palette, accent: '#356f4f' },
            paper: 'linen' as const,
          },
        },
      },
    };
    const requestId = randomUUID();
    expect(templates(command, requestId, f.context.session)).toMatchObject({
      kind: 'recipeTemplate',
      outcome: 'committed',
      template: {
        templateId: null,
        templateName: 'Перенесённый гербарий',
        layout: 'herbarium',
        theme: { name: 'Лесная бумага', paper: 'linen', palette: { accent: '#356f4f' } },
      },
    });
    expect(templates(command, requestId, f.context.session)).toMatchObject({
      outcome: 'replayed',
      template: { revision: 1, theme: { name: 'Лесная бумага' } },
    });
  });
});
