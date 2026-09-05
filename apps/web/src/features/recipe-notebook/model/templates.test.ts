import { expect, it } from 'vitest';
import type { RecipeTemplateView, TemplateCommand, TemplateData } from '@tastory/contracts';
import { BUILTIN_RECIPE_TEMPLATES, TEMPLATE_API_CAPABILITIES } from '@tastory/contracts';
import { loadTemplateLibrary, loadTemplateWorkspace } from './templates';

function templateId(index: number) {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, '0')}`;
}

function library(size: number): RecipeTemplateView[] {
  const source = BUILTIN_RECIPE_TEMPLATES[0];
  if (!source) throw new Error('fixture');
  return Array.from({ length: size }, (_, index) => ({
    template: {
      ...source,
      id: templateId(index + 1),
      name: `Шаблон ${index + 1}`,
    },
    authorName: 'Tastory',
    canManage: false,
    canCopy: true,
  }));
}

it('loads every page when the template library contains more than one hundred entries', async () => {
  const all = library(211);
  const offsets: number[] = [];
  const request = async (command: TemplateCommand): Promise<TemplateData> => {
    if (command.action !== 'templates.list') throw new Error('unexpected');
    const { offset, limit } = command.payload;
    if (offset === undefined || limit === undefined) throw new Error('expected paginated request');
    offsets.push(offset);
    const end = Math.min(offset + limit, all.length);
    return {
      kind: 'templateLibrary',
      templates: all.slice(offset, end),
      nextOffset: end < all.length ? end : null,
    };
  };

  await expect(loadTemplateLibrary(request)).resolves.toEqual(all);
  expect(offsets).toEqual([0, 100, 200]);
});

it('rejects a page that cannot advance the agreed offset', async () => {
  const request = async (): Promise<TemplateData> => ({
    kind: 'templateLibrary',
    templates: library(1),
    nextOffset: 99,
  });
  await expect(loadTemplateLibrary(request)).rejects.toThrow('некорректное продолжение');
});

it('checks v3 capabilities before loading the recipe template workspace', async () => {
  const recipeId = templateId(900);
  const actions: string[] = [];
  const request = async (command: TemplateCommand): Promise<TemplateData> => {
    actions.push(command.action);
    if (command.action === 'templates.capabilities') return TEMPLATE_API_CAPABILITIES;
    if (command.action === 'templates.list')
      return { kind: 'templateLibrary', templates: [], nextOffset: null };
    if (command.action === 'recipes.template.get')
      return { kind: 'recipeTemplate', recipeId, template: null, outcome: 'read' };
    if (command.action === 'recipes.design.get')
      return { kind: 'recipeDesign', recipeId, design: null, outcome: 'read' };
    throw new Error('unexpected');
  };

  await expect(loadTemplateWorkspace(recipeId, request)).resolves.toEqual({
    items: [],
    applied: null,
    design: null,
  });
  expect(actions[0]).toBe('templates.capabilities');
  expect(actions.slice(1).sort()).toEqual([
    'recipes.design.get',
    'recipes.template.get',
    'templates.list',
  ]);
});
