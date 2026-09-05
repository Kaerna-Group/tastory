import { TEMPLATE_API_CAPABILITIES, TEMPLATE_LIMITS } from '@tastory/contracts';
import type { RecipeTemplateView, TemplateCommand, TemplateData } from '@tastory/contracts';
import { ApiClientError } from '@/shared/api';

export {
  BUILTIN_RECIPE_TEMPLATES,
  DEFAULT_RECIPE_THEME,
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
  templateCategoryForLayout,
  recipeDesignValueSchema,
} from '@tastory/contracts';
export type {
  RecipeDesign,
  RecipeDesignElement,
  RecipeDesignValue,
  RecipeTemplate,
  RecipeTemplateCategory,
  RecipeTemplateLayout,
  RecipeTemplateView,
  RecipeTheme,
  TemplateCommand,
  TemplateData,
} from '@tastory/contracts';

type TemplateRequest = (
  command: TemplateCommand,
  requestId: string,
  signal?: AbortSignal,
) => Promise<TemplateData>;

export async function loadTemplateLibrary(request: TemplateRequest, signal?: AbortSignal) {
  const templates: RecipeTemplateView[] = [];
  const ids = new Set<string>();
  let nextOffset: number | null = 0;
  while (nextOffset !== null) {
    const offset: number = nextOffset;
    signal?.throwIfAborted();
    const result = await request(
      {
        action: 'templates.list',
        payload: {
          query: '',
          category: 'all',
          scope: 'all',
          includeArchived: true,
          offset,
          limit: TEMPLATE_LIMITS.listPage,
        },
      },
      crypto.randomUUID(),
      signal,
    );
    if (result.kind !== 'templateLibrary')
      throw new Error('Сервер вернул несовместимую библиотеку шаблонов.');
    if (result.nextOffset === undefined)
      throw new Error('Сервер шаблонов не подтвердил постраничную выдачу.');
    if (result.templates.some((item) => ids.has(item.template.id)))
      throw new Error('Сервер повторил шаблон на следующей странице библиотеки.');
    for (const item of result.templates) {
      ids.add(item.template.id);
      templates.push(item);
    }
    if (
      result.nextOffset !== null &&
      (result.nextOffset <= offset || result.nextOffset !== offset + result.templates.length)
    )
      throw new Error('Сервер вернул некорректное продолжение библиотеки шаблонов.');
    nextOffset = result.nextOffset;
  }
  return templates;
}

export async function loadTemplateWorkspace(
  recipeId: string,
  request: TemplateRequest,
  signal?: AbortSignal,
) {
  let capabilities: TemplateData;
  try {
    capabilities = await request(
      { action: 'templates.capabilities', payload: {} },
      crypto.randomUUID(),
      signal,
    );
  } catch (cause) {
    if (
      cause instanceof ApiClientError &&
      ['INVALID_REQUEST', 'ACTION_DISABLED', 'INVALID_RESPONSE'].includes(cause.code)
    )
      throw new Error('Сначала обновите Apps Script backend: библиотеке нужен template API v3.', {
        cause,
      });
    throw cause;
  }
  if (
    capabilities.kind !== TEMPLATE_API_CAPABILITIES.kind ||
    capabilities.protocolVersion !== TEMPLATE_API_CAPABILITIES.protocolVersion ||
    !capabilities.durableMutationReplay ||
    !capabilities.recipeTemplateRevisionConflict ||
    !capabilities.paginatedLibrary ||
    !capabilities.durableRecipeDesigns
  )
    throw new Error('Apps Script backend не поддерживает безопасные команды шаблонов.');
  const [items, current, design] = await Promise.all([
    loadTemplateLibrary(request, signal),
    request({ action: 'recipes.template.get', payload: { recipeId } }, crypto.randomUUID(), signal),
    request({ action: 'recipes.design.get', payload: { recipeId } }, crypto.randomUUID(), signal),
  ]);
  if (current.kind !== 'recipeTemplate')
    throw new Error('Сервер вернул несовместимое оформление рецепта.');
  if (design.kind !== 'recipeDesign')
    throw new Error('Сервер вернул несовместимый документ оформления рецепта.');
  return { items, applied: current.template, design: design.design };
}
