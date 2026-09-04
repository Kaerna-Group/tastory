export const RECIPE_SCHEMA_VERSION = 8;
export const TEMPLATE_RECIPE_MIGRATION_ID = '008-recipe-templates';
export const TEMPLATE_RECIPE_MIGRATION_NAME = 'Recipe template library and applied snapshots';
export const STICKER_RECIPE_MIGRATION_ID = '007-sticker-packs';
export const STICKER_RECIPE_MIGRATION_NAME = 'Sticker packs and durable recipe placements';
export const SETTINGS_RECIPE_MIGRATION_ID = '006-user-settings';
export const SETTINGS_RECIPE_MIGRATION_NAME = 'Synchronized user preferences';
export const RECIPE_MIGRATION_ID = '005-recipe-library';
export const RECIPE_MIGRATION_NAME = 'Personal recipe library state';
export const PHOTO_RECIPE_MIGRATION_ID = '004-recipe-photos';
export const PHOTO_RECIPE_MIGRATION_NAME = 'Private recipe photos';
export const LEGACY_RECIPE_MIGRATION_ID = '003-recipe-storage';
export const LEGACY_RECIPE_MIGRATION_NAME = 'Versioned recipes and durable receipts';
export const RECIPE_OPERATION_LIMIT = 10000;
export const RECIPE_ROW_LIMIT = 100000;
export const RECIPE_TABLES = [
  {
    name: 'Recipes',
    columns: [
      'version_id',
      'id',
      'workspace_id',
      'owner_user_id',
      'title',
      'description',
      'servings',
      'prep_minutes',
      'cook_minutes',
      'source_url',
      'notes',
      'visibility',
      'status',
      'created_at',
      'updated_at',
      'revision',
      'deleted_at',
    ],
  },
  {
    name: 'RecipeIngredients',
    columns: [
      'version_id',
      'id',
      'recipe_id',
      'section_title',
      'position',
      'name',
      'quantity_value',
      'quantity_text',
      'unit',
      'note',
      'is_optional',
      'created_at',
      'updated_at',
      'revision',
    ],
  },
  {
    name: 'RecipeSteps',
    columns: [
      'version_id',
      'id',
      'recipe_id',
      'section_title',
      'position',
      'body',
      'duration_seconds',
      'created_at',
      'updated_at',
      'revision',
    ],
  },
  {
    name: 'RecipePhotos',
    columns: [
      'version_id',
      'id',
      'recipe_id',
      'kind',
      'step_id',
      'position',
      'width',
      'height',
      'bytes',
      'thumbnail_bytes',
      'image_digest',
      'thumbnail_digest',
      'created_at',
      'updated_at',
      'revision',
    ],
  },
  {
    name: 'Tags',
    columns: [
      'version_id',
      'id',
      'workspace_id',
      'name',
      'normalized_name',
      'color_token',
      'created_by',
      'status',
      'created_at',
      'updated_at',
      'revision',
    ],
  },
  {
    name: 'RecipeTags',
    columns: [
      'version_id',
      'recipe_id',
      'tag_id',
      'assigned_by',
      'created_at',
      'updated_at',
      'revision',
    ],
  },
  {
    name: 'RecipeOperations',
    columns: [
      'request_id',
      'workspace_id',
      'user_id',
      'action',
      'entity_type',
      'entity_id',
      'base_revision',
      'revision',
      'payload_hash',
      'before_hash',
      'snapshot_hash',
      'recipe_count',
      'ingredient_count',
      'step_count',
      'tag_count',
      'link_count',
      'started_at',
      'state',
    ],
  },
  {
    name: 'RecipeFavorites',
    columns: ['request_id', 'workspace_id', 'user_id', 'recipe_id', 'is_favorite', 'created_at'],
  },
  {
    name: 'UserSettings',
    columns: [
      'request_id',
      'workspace_id',
      'user_id',
      'base_revision',
      'revision',
      'display_name',
      'unit_system',
      'temperature_unit',
      'default_visibility',
      'editor_density',
      'autosave_delay',
      'keyboard_shortcuts',
      'confirm_destructive_actions',
      'updated_at',
    ],
  },
  {
    name: 'StickerPacks',
    columns: [
      'version_id',
      'id',
      'workspace_id',
      'owner_user_id',
      'kind',
      'name',
      'emoji',
      'visibility',
      'status',
      'position',
      'revision',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Stickers',
    columns: [
      'version_id',
      'id',
      'pack_id',
      'name',
      'normalized_name',
      'emoji',
      'position',
      'mime_type',
      'width',
      'height',
      'bytes',
      'digest',
      'asset_key',
      'status',
      'revision',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'RecipeStickers',
    columns: [
      'version_id',
      'id',
      'recipe_id',
      'sticker_id',
      'pack_id',
      'name',
      'emoji',
      'mime_type',
      'asset_width',
      'asset_height',
      'asset_bytes',
      'asset_digest',
      'asset_key',
      'page',
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'z_index',
      'status',
      'revision',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'StickerOperations',
    columns: [
      'request_id',
      'workspace_id',
      'user_id',
      'action',
      'entity_id',
      'payload_hash',
      'started_at',
      'state',
    ],
  },
  {
    name: 'Templates',
    columns: [
      'version_id',
      'id',
      'workspace_id',
      'owner_user_id',
      'kind',
      'name',
      'description',
      'category',
      'layout',
      'visibility',
      'status',
      'source_template_id',
      'revision',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'RecipeTemplates',
    columns: [
      'version_id',
      'id',
      'recipe_id',
      'template_id',
      'template_name',
      'category',
      'layout',
      'source_owner_user_id',
      'revision',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'TemplateOperations',
    columns: [
      'request_id',
      'workspace_id',
      'user_id',
      'action',
      'entity_id',
      'payload_hash',
      'started_at',
      'state',
    ],
  },
] as const;
export type RecipeTableName = (typeof RECIPE_TABLES)[number]['name'];
export type RecipeDataTable = Exclude<
  RecipeTableName,
  | 'RecipeOperations'
  | 'RecipeFavorites'
  | 'UserSettings'
  | 'StickerPacks'
  | 'Stickers'
  | 'RecipeStickers'
  | 'StickerOperations'
  | 'Templates'
  | 'RecipeTemplates'
  | 'TemplateOperations'
>;
const STICKER_TABLES = new Set(['StickerPacks', 'Stickers', 'RecipeStickers', 'StickerOperations']);
const TEMPLATE_TABLES = new Set(['Templates', 'RecipeTemplates', 'TemplateOperations']);
export const RECIPE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: RECIPE_MIGRATION_ID,
  name: RECIPE_MIGRATION_NAME,
  version: 5,
  tables: RECIPE_TABLES.filter(
    ({ name }) =>
      name !== 'UserSettings' && !STICKER_TABLES.has(name) && !TEMPLATE_TABLES.has(name),
  ),
  algorithm: 'immutable-scalar-snapshots-single-cell-publication-v1',
});
export const SETTINGS_RECIPE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: SETTINGS_RECIPE_MIGRATION_ID,
  name: SETTINGS_RECIPE_MIGRATION_NAME,
  version: 7,
  tables: RECIPE_TABLES.filter(
    ({ name }) => !STICKER_TABLES.has(name) && !TEMPLATE_TABLES.has(name),
  ),
  algorithm: 'append-only-user-settings-v1',
});
export const LEGACY_RECIPE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: LEGACY_RECIPE_MIGRATION_ID,
  name: LEGACY_RECIPE_MIGRATION_NAME,
  version: 3,
  tables: RECIPE_TABLES.filter(
    ({ name }) =>
      name !== 'RecipePhotos' &&
      name !== 'RecipeFavorites' &&
      name !== 'UserSettings' &&
      !STICKER_TABLES.has(name) &&
      !TEMPLATE_TABLES.has(name),
  ),
  algorithm: 'immutable-scalar-snapshots-single-cell-publication-v1',
});
export const PHOTO_RECIPE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: PHOTO_RECIPE_MIGRATION_ID,
  name: PHOTO_RECIPE_MIGRATION_NAME,
  version: 4,
  tables: RECIPE_TABLES.filter(
    ({ name }) =>
      name !== 'RecipeFavorites' &&
      name !== 'UserSettings' &&
      !STICKER_TABLES.has(name) &&
      !TEMPLATE_TABLES.has(name),
  ),
  algorithm: 'immutable-scalar-snapshots-single-cell-publication-v1',
});
export const STICKER_RECIPE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: STICKER_RECIPE_MIGRATION_ID,
  name: STICKER_RECIPE_MIGRATION_NAME,
  version: 7,
  tables: RECIPE_TABLES.filter(({ name }) => !TEMPLATE_TABLES.has(name)),
  algorithm: 'append-only-sticker-snapshots-single-cell-publication-v1',
});
export const TEMPLATE_RECIPE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: TEMPLATE_RECIPE_MIGRATION_ID,
  name: TEMPLATE_RECIPE_MIGRATION_NAME,
  version: RECIPE_SCHEMA_VERSION,
  tables: RECIPE_TABLES,
  algorithm: 'append-only-template-snapshots-single-cell-publication-v1',
});
