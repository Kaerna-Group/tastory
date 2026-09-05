import {
  DESIGN_RECIPE_MIGRATION_ID,
  DESIGN_RECIPE_MIGRATION_NAME,
  LEGACY_RECIPE_MIGRATION_ID,
  LEGACY_RECIPE_MIGRATION_NAME,
  PHOTO_RECIPE_MIGRATION_ID,
  PHOTO_RECIPE_MIGRATION_NAME,
  RECIPE_TABLES,
  RECIPE_MIGRATION_ID,
  RECIPE_MIGRATION_NAME,
  SETTINGS_RECIPE_MIGRATION_ID,
  SETTINGS_RECIPE_MIGRATION_NAME,
  STICKER_RECIPE_MIGRATION_ID,
  STICKER_RECIPE_MIGRATION_NAME,
  TEMPLATE_RECIPE_MIGRATION_ID,
  TEMPLATE_RECIPE_MIGRATION_NAME,
} from '../schema/recipe-schema';
import { planJournalSchema } from './journal-migration';
import type { JournalMigrationOptions } from './journal-migration';
import { RecipeStorageError } from './recipe-storage';
import type { RecipeStore } from './recipe-storage';

export function planRecipeSchema(store: RecipeStore, options: JournalMigrationOptions) {
  const meta = store.journal.core.read('Meta');
  const version = meta?.rows.find((row) => row[0] === 'schema_version')?.[1];
  if (
    !/^[a-f0-9]{64}$/.test(options.recipeChecksum ?? '') ||
    !/^[a-f0-9]{64}$/.test(options.settingsRecipeChecksum ?? '') ||
    !/^[a-f0-9]{64}$/.test(options.stickerRecipeChecksum ?? '') ||
    !/^[a-f0-9]{64}$/.test(options.templateRecipeChecksum ?? '') ||
    !/^[a-f0-9]{64}$/.test(options.designRecipeChecksum ?? '') ||
    !['2', '3', '4', '5', '6', '7', '8', '9'].includes(version ?? '') ||
    !planJournalSchema(store.journal, options).alreadyApplied
  )
    throw new RecipeStorageError('RECIPE_NOT_READY');
  const actions = RECIPE_TABLES.map(({ name, columns }) => {
    const table = store.read(name);
    if (!table) return { table: name, action: 'create' as const };
    if (table.rowCount === 0 && table.columnCount === 0)
      return { table: name, action: 'initialize' as const };
    if (
      table.columnCount !== columns.length ||
      columns.some((column, i) => table.headers[i] !== column) ||
      (version === '2' && table.rowCount > 1) ||
      (version === '8' && name === 'RecipeDesigns' && table.rowCount > 1)
    )
      throw new RecipeStorageError();
    return { table: name, action: 'keep' as const };
  });
  if (
    version === '3' &&
    actions.some(
      (action) =>
        action.action !== 'keep' &&
        action.table !== 'RecipePhotos' &&
        action.table !== 'RecipeFavorites' &&
        action.table !== 'UserSettings' &&
        !['StickerPacks', 'Stickers', 'RecipeStickers', 'StickerOperations'].includes(
          action.table,
        ) &&
        !['Templates', 'RecipeTemplates', 'TemplateOperations'].includes(action.table) &&
        action.table !== 'RecipeDesigns',
    )
  )
    throw new RecipeStorageError();
  if (
    version === '4' &&
    actions.some(
      (action) =>
        action.action !== 'keep' &&
        action.table !== 'RecipeFavorites' &&
        action.table !== 'UserSettings' &&
        !['StickerPacks', 'Stickers', 'RecipeStickers', 'StickerOperations'].includes(
          action.table,
        ) &&
        !['Templates', 'RecipeTemplates', 'TemplateOperations'].includes(action.table) &&
        action.table !== 'RecipeDesigns',
    )
  )
    throw new RecipeStorageError();
  if (
    version === '5' &&
    actions.some(
      (action) =>
        action.action !== 'keep' &&
        action.table !== 'UserSettings' &&
        !['StickerPacks', 'Stickers', 'RecipeStickers', 'StickerOperations'].includes(
          action.table,
        ) &&
        !['Templates', 'RecipeTemplates', 'TemplateOperations'].includes(action.table) &&
        action.table !== 'RecipeDesigns',
    )
  )
    throw new RecipeStorageError();
  const stickerTables = new Set([
    'StickerPacks',
    'Stickers',
    'RecipeStickers',
    'StickerOperations',
  ]);
  const templateTables = new Set(['Templates', 'RecipeTemplates', 'TemplateOperations']);
  const designTables = new Set(['RecipeDesigns']);
  if (
    version === '6' &&
    actions.some(
      (action) =>
        action.action !== 'keep' &&
        !stickerTables.has(action.table) &&
        !templateTables.has(action.table) &&
        !designTables.has(action.table),
    )
  )
    throw new RecipeStorageError();
  if (
    version === '7' &&
    actions.some(
      (action) =>
        action.action !== 'keep' &&
        !templateTables.has(action.table) &&
        !designTables.has(action.table),
    )
  )
    throw new RecipeStorageError();
  if (
    version === '8' &&
    actions.some((action) => action.action !== 'keep' && !designTables.has(action.table))
  )
    throw new RecipeStorageError();
  if (version === '9' && actions.some((action) => action.action !== 'keep'))
    throw new RecipeStorageError();
  return {
    alreadyApplied: version === '9',
    actions,
    fromVersion: Number(version),
    toVersion: 9 as const,
  };
}
export function applyRecipeSchema(store: RecipeStore, options: JournalMigrationOptions) {
  const plan = planRecipeSchema(store, options);
  if (plan.alreadyApplied) return plan;
  const timestamp = options.now().toISOString();
  for (const action of plan.actions) {
    if (action.action === 'keep') continue;
    const definition = RECIPE_TABLES.find((table) => table.name === action.table);
    if (!definition) throw new RecipeStorageError();
    options.beforeWrite?.();
    if (action.action === 'create') store.create(action.table);
    options.beforeWrite?.();
    store.writeRows(action.table, 1, [definition.columns]);
  }
  store.flush();
  let migrations = store.journal.core.read('SchemaMigrations')?.rows;
  if (
    !migrations ||
    !options.recipeChecksum ||
    !options.legacyRecipeChecksum ||
    !options.photoRecipeChecksum ||
    !options.settingsRecipeChecksum ||
    !options.stickerRecipeChecksum ||
    !options.templateRecipeChecksum ||
    !options.designRecipeChecksum
  )
    throw new RecipeStorageError();
  if (plan.fromVersion === 2 && !migrations.some((row) => row[0] === LEGACY_RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      LEGACY_RECIPE_MIGRATION_ID,
      LEGACY_RECIPE_MIGRATION_NAME,
      options.legacyRecipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
    migrations = store.journal.core.read('SchemaMigrations')?.rows;
    if (!migrations) throw new RecipeStorageError();
  }
  if (plan.fromVersion <= 3 && !migrations.some((row) => row[0] === PHOTO_RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      PHOTO_RECIPE_MIGRATION_ID,
      PHOTO_RECIPE_MIGRATION_NAME,
      options.photoRecipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
    migrations = store.journal.core.read('SchemaMigrations')?.rows;
    if (!migrations) throw new RecipeStorageError();
  }
  if (!migrations.some((row) => row[0] === RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      RECIPE_MIGRATION_ID,
      RECIPE_MIGRATION_NAME,
      options.recipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
    migrations = store.journal.core.read('SchemaMigrations')?.rows;
    if (!migrations) throw new RecipeStorageError();
  }
  if (!migrations.some((row) => row[0] === SETTINGS_RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      SETTINGS_RECIPE_MIGRATION_ID,
      SETTINGS_RECIPE_MIGRATION_NAME,
      options.settingsRecipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
    migrations = store.journal.core.read('SchemaMigrations')?.rows;
    if (!migrations) throw new RecipeStorageError();
  }
  if (!migrations.some((row) => row[0] === STICKER_RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      STICKER_RECIPE_MIGRATION_ID,
      STICKER_RECIPE_MIGRATION_NAME,
      options.stickerRecipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
    migrations = store.journal.core.read('SchemaMigrations')?.rows;
    if (!migrations) throw new RecipeStorageError();
  }
  if (!migrations.some((row) => row[0] === TEMPLATE_RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      TEMPLATE_RECIPE_MIGRATION_ID,
      TEMPLATE_RECIPE_MIGRATION_NAME,
      options.templateRecipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
    migrations = store.journal.core.read('SchemaMigrations')?.rows;
    if (!migrations) throw new RecipeStorageError();
  }
  if (!migrations.some((row) => row[0] === DESIGN_RECIPE_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.journal.core.writeRow('SchemaMigrations', migrations.length + 2, [
      DESIGN_RECIPE_MIGRATION_ID,
      DESIGN_RECIPE_MIGRATION_NAME,
      options.designRecipeChecksum,
      timestamp,
      'system:setupRecipes',
      'applied',
    ]);
    store.flush();
  }
  const versionIndex =
    store.journal.core.read('Meta')?.rows.findIndex((row) => row[0] === 'schema_version') ?? -1;
  if (versionIndex < 0) throw new RecipeStorageError();
  options.beforeWrite?.();
  store.journal.core.writeRow('Meta', versionIndex + 2, ['schema_version', '9', timestamp]);
  store.flush();
  return planRecipeSchema(store, options);
}
