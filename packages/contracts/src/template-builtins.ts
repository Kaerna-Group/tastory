import { templateSchema } from './template';
import type { RecipeTemplateRecord } from './template';

const createdAt = '2026-09-04T00:00:00.000Z';
const builtin = (
  id: string,
  name: string,
  description: string,
  layout: RecipeTemplateRecord['layout'],
): RecipeTemplateRecord =>
  templateSchema.parse({
    id,
    workspaceId: null,
    ownerUserId: null,
    kind: 'builtin',
    name,
    description,
    category: ['hearth', 'bistro', 'herbarium', 'celebration', 'notebook'].includes(layout)
      ? 'dish'
      : 'drink',
    layout,
    visibility: 'workspace',
    status: 'active',
    sourceTemplateId: null,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  });

export const BUILTIN_RECIPE_TEMPLATES: readonly RecipeTemplateRecord[] = [
  builtin(
    'a1100000-0000-4000-8000-000000000001',
    'Тёплый очаг',
    'Большая подача, спокойная колонка ингредиентов и тёплая домашняя рамка.',
    'hearth',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000002',
    'Городское бистро',
    'Контрастная журнальная композиция для современных блюд и быстрых ужинов.',
    'bistro',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000003',
    'Сад и травы',
    'Воздушный лист с ботаническими деталями для сезонных и лёгких блюд.',
    'herbarium',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000004',
    'Праздничная подача',
    'Центральная композиция с аккуратной рамкой для особенных семейных рецептов.',
    'celebration',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000005',
    'Семейная тетрадь',
    'Рукописное настроение, поля для заметок и знакомая клетчатая структура.',
    'notebook',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000006',
    'Домашняя кофейня',
    'Тёплая карточка напитка с местом для зерна, температуры и личных заметок.',
    'coffeehouse',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000007',
    'Чайная церемония',
    'Тихая симметричная композиция для чая, настоев и медленных ритуалов.',
    'tea-ceremony',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000008',
    'Коктейльный вечер',
    'Выразительный вертикальный ритм для коктейлей и праздничных напитков.',
    'cocktail-night',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000009',
    'Свежий бар',
    'Светлая динамичная сетка для лимонадов, смузи и сезонных миксов.',
    'fresh-bar',
  ),
  builtin(
    'a1100000-0000-4000-8000-000000000010',
    'Винный погреб',
    'Сдержанная этикетка с классической типографикой для вина и домашних настоек.',
    'wine-cellar',
  ),
] as const;
