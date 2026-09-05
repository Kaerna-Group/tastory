import type { SchemaStore, TableSnapshot, MigrationOptions } from './core-migration';
import { planCoreSchema } from './core-migration';
import {
  JOURNAL_MIGRATION_ID,
  JOURNAL_MIGRATION_NAME,
  JOURNAL_TABLES,
} from '../schema/journal-schema';
import type { JournalTableName } from '../schema/journal-schema';
import { JournalError } from './journal-error';
import {
  DESIGN_RECIPE_MIGRATION_ID,
  DESIGN_RECIPE_MIGRATION_NAME,
  LEGACY_RECIPE_MIGRATION_ID,
  LEGACY_RECIPE_MIGRATION_NAME,
  PHOTO_RECIPE_MIGRATION_ID,
  PHOTO_RECIPE_MIGRATION_NAME,
  RECIPE_MIGRATION_ID,
  RECIPE_MIGRATION_NAME,
  SETTINGS_RECIPE_MIGRATION_ID,
  SETTINGS_RECIPE_MIGRATION_NAME,
  STICKER_RECIPE_MIGRATION_ID,
  STICKER_RECIPE_MIGRATION_NAME,
  TEMPLATE_RECIPE_MIGRATION_ID,
  TEMPLATE_RECIPE_MIGRATION_NAME,
} from '../schema/recipe-schema';

export type JournalStore = {
  core: SchemaStore;
  readTable: (name: JournalTableName) => TableSnapshot | null;
  createTable: (name: JournalTableName) => void;
  writeTableRow: (name: JournalTableName, row: number, values: readonly string[]) => void;
  flush: () => void;
};
export type JournalMigrationOptions = MigrationOptions & {
  journalChecksum: string;
  recipeChecksum?: string;
  legacyRecipeChecksum?: string;
  photoRecipeChecksum?: string;
  settingsRecipeChecksum?: string;
  stickerRecipeChecksum?: string;
  templateRecipeChecksum?: string;
  designRecipeChecksum?: string;
  beforeWrite?: () => void;
};

export function planJournalSchema(store: JournalStore, options: JournalMigrationOptions) {
  if (!/^[a-f0-9]{64}$/.test(options.journalChecksum)) throw new JournalError();
  const meta = store.core.read('Meta');
  const log = store.core.read('SchemaMigrations');
  const version = meta?.rows.find((row) => row[0] === 'schema_version')?.[1];
  if (!meta || !log || !['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(version ?? ''))
    throw new JournalError();
  const legacyRecipeRecords = log.rows.filter((row) => row[0] === LEGACY_RECIPE_MIGRATION_ID);
  const legacyRecipeRecord = legacyRecipeRecords[0];
  const recipeRecords = log.rows.filter((row) => row[0] === RECIPE_MIGRATION_ID);
  const recipeRecord = recipeRecords[0];
  const photoRecipeRecords = log.rows.filter((row) => row[0] === PHOTO_RECIPE_MIGRATION_ID);
  const photoRecipeRecord = photoRecipeRecords[0];
  const settingsRecipeRecords = log.rows.filter((row) => row[0] === SETTINGS_RECIPE_MIGRATION_ID);
  const settingsRecipeRecord = settingsRecipeRecords[0];
  const stickerRecipeRecords = log.rows.filter((row) => row[0] === STICKER_RECIPE_MIGRATION_ID);
  const stickerRecipeRecord = stickerRecipeRecords[0];
  const templateRecipeRecords = log.rows.filter((row) => row[0] === TEMPLATE_RECIPE_MIGRATION_ID);
  const templateRecipeRecord = templateRecipeRecords[0];
  const designRecipeRecords = log.rows.filter((row) => row[0] === DESIGN_RECIPE_MIGRATION_ID);
  const designRecipeRecord = designRecipeRecords[0];
  if (
    legacyRecipeRecords.length > 1 ||
    photoRecipeRecords.length > 1 ||
    recipeRecords.length > 1 ||
    settingsRecipeRecords.length > 1 ||
    stickerRecipeRecords.length > 1 ||
    templateRecipeRecords.length > 1 ||
    designRecipeRecords.length > 1 ||
    (version === '3' && !legacyRecipeRecord) ||
    (version === '4' && (!legacyRecipeRecord || !photoRecipeRecord)) ||
    (version === '5' && (!legacyRecipeRecord || !photoRecipeRecord || !recipeRecord)) ||
    (version === '6' &&
      (!legacyRecipeRecord || !photoRecipeRecord || !recipeRecord || !settingsRecipeRecord)) ||
    (version === '7' &&
      (!legacyRecipeRecord ||
        !photoRecipeRecord ||
        !recipeRecord ||
        !settingsRecipeRecord ||
        !stickerRecipeRecord)) ||
    (version === '8' &&
      (!legacyRecipeRecord ||
        !photoRecipeRecord ||
        !recipeRecord ||
        !settingsRecipeRecord ||
        !stickerRecipeRecord ||
        !templateRecipeRecord)) ||
    (version === '9' &&
      (!legacyRecipeRecord ||
        !photoRecipeRecord ||
        !recipeRecord ||
        !settingsRecipeRecord ||
        !stickerRecipeRecord ||
        !templateRecipeRecord ||
        !designRecipeRecord)) ||
    (legacyRecipeRecord &&
      (version === '1' ||
        legacyRecipeRecord.length !== 6 ||
        legacyRecipeRecord[1] !== LEGACY_RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.legacyRecipeChecksum ?? '') ||
        legacyRecipeRecord[2] !== options.legacyRecipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(legacyRecipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(legacyRecipeRecord[3] ?? '')) ||
        legacyRecipeRecord[4] !== 'system:setupRecipes' ||
        legacyRecipeRecord[5] !== 'applied')) ||
    (photoRecipeRecord &&
      (version === '1' ||
        photoRecipeRecord.length !== 6 ||
        photoRecipeRecord[1] !== PHOTO_RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.photoRecipeChecksum ?? '') ||
        photoRecipeRecord[2] !== options.photoRecipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(photoRecipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(photoRecipeRecord[3] ?? '')) ||
        photoRecipeRecord[4] !== 'system:setupRecipes' ||
        photoRecipeRecord[5] !== 'applied')) ||
    (recipeRecord &&
      (version === '1' ||
        recipeRecord.length !== 6 ||
        recipeRecord[1] !== RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.recipeChecksum ?? '') ||
        recipeRecord[2] !== options.recipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(recipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(recipeRecord[3] ?? '')) ||
        recipeRecord[4] !== 'system:setupRecipes' ||
        recipeRecord[5] !== 'applied')) ||
    (settingsRecipeRecord &&
      (settingsRecipeRecord.length !== 6 ||
        settingsRecipeRecord[1] !== SETTINGS_RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.settingsRecipeChecksum ?? '') ||
        settingsRecipeRecord[2] !== options.settingsRecipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(settingsRecipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(settingsRecipeRecord[3] ?? '')) ||
        settingsRecipeRecord[4] !== 'system:setupRecipes' ||
        settingsRecipeRecord[5] !== 'applied')) ||
    (stickerRecipeRecord &&
      (stickerRecipeRecord.length !== 6 ||
        stickerRecipeRecord[1] !== STICKER_RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.stickerRecipeChecksum ?? '') ||
        stickerRecipeRecord[2] !== options.stickerRecipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(stickerRecipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(stickerRecipeRecord[3] ?? '')) ||
        stickerRecipeRecord[4] !== 'system:setupRecipes' ||
        stickerRecipeRecord[5] !== 'applied')) ||
    (templateRecipeRecord &&
      (templateRecipeRecord.length !== 6 ||
        templateRecipeRecord[1] !== TEMPLATE_RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.templateRecipeChecksum ?? '') ||
        templateRecipeRecord[2] !== options.templateRecipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(templateRecipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(templateRecipeRecord[3] ?? '')) ||
        templateRecipeRecord[4] !== 'system:setupRecipes' ||
        templateRecipeRecord[5] !== 'applied')) ||
    (designRecipeRecord &&
      (designRecipeRecord.length !== 6 ||
        designRecipeRecord[1] !== DESIGN_RECIPE_MIGRATION_NAME ||
        !/^[a-f0-9]{64}$/.test(options.designRecipeChecksum ?? '') ||
        designRecipeRecord[2] !== options.designRecipeChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(designRecipeRecord[3] ?? '') ||
        !Number.isFinite(Date.parse(designRecipeRecord[3] ?? '')) ||
        designRecipeRecord[4] !== 'system:setupRecipes' ||
        designRecipeRecord[5] !== 'applied'))
  )
    throw new JournalError();
  if (meta.rows.find((row) => row[0] === 'maintenance_mode')?.[1] !== 'false')
    throw new JournalError();
  const records = log.rows.filter((row) => row[0] === JOURNAL_MIGRATION_ID);
  const record = records[0];
  if (
    records.length > 1 ||
    (record &&
      (record.length !== 6 ||
        record[1] !== JOURNAL_MIGRATION_NAME ||
        record[2] !== options.journalChecksum ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(record[3] ?? '') ||
        !Number.isFinite(Date.parse(record[3] ?? '')) ||
        record[4] !== 'system:setupJournal' ||
        record[5] !== 'applied'))
  )
    throw new JournalError();
  // Validate migration 001 unchanged. Only the known, validated 002 record and version are
  // projected away; unknown migrations and every original header/checksum remain checked.
  const base: SchemaStore = {
    ...store.core,
    read(name) {
      if (name === 'Meta')
        return {
          ...meta,
          rows: meta.rows.map((row) =>
            row[0] === 'schema_version' ? [row[0], '1', row[2] ?? ''] : row,
          ),
        };
      if (name === 'SchemaMigrations') {
        const known = log.rows.filter(
          (row) =>
            row[0] !== JOURNAL_MIGRATION_ID &&
            row[0] !== RECIPE_MIGRATION_ID &&
            row[0] !== PHOTO_RECIPE_MIGRATION_ID &&
            row[0] !== LEGACY_RECIPE_MIGRATION_ID &&
            row[0] !== SETTINGS_RECIPE_MIGRATION_ID &&
            row[0] !== STICKER_RECIPE_MIGRATION_ID &&
            row[0] !== TEMPLATE_RECIPE_MIGRATION_ID &&
            row[0] !== DESIGN_RECIPE_MIGRATION_ID,
        );
        return { ...log, rows: known, rowCount: known.length + 1 };
      }
      return store.core.read(name);
    },
  };
  if (!planCoreSchema(base, options).alreadyApplied) throw new JournalError();
  const actions = JOURNAL_TABLES.map(({ name, columns }) => {
    const table = store.readTable(name);
    if (!table) return { table: name, action: 'create' as const };
    if (table.rowCount === 0 && table.columnCount === 0)
      return { table: name, action: 'initialize' as const };
    if (
      table.columnCount !== columns.length ||
      columns.some((column, i) => table.headers[i] !== column)
    )
      throw new JournalError();
    if (version === '1' && !record && table.rowCount > 1) throw new JournalError();
    return { table: name, action: 'keep' as const };
  });
  if ((version !== '1' || record) && actions.some(({ action }) => action !== 'keep'))
    throw new JournalError();
  if (version !== '1' && !record) throw new JournalError();
  return {
    fromVersion: Number(version),
    toVersion: 2 as const,
    migrationId: JOURNAL_MIGRATION_ID,
    actions,
    alreadyApplied: version !== '1',
  };
}

export function applyJournalSchema(store: JournalStore, options: JournalMigrationOptions) {
  const plan = planJournalSchema(store, options);
  if (plan.alreadyApplied) return { ...plan, result: 'already-applied' as const };
  const timestamp = options.now().toISOString();
  for (const action of plan.actions) {
    if (action.action === 'keep') continue;
    options.beforeWrite?.();
    if (action.action === 'create') store.createTable(action.table);
    const definition = JOURNAL_TABLES.find((table) => table.name === action.table);
    if (!definition) throw new JournalError();
    options.beforeWrite?.();
    store.writeTableRow(action.table, 1, definition.columns);
  }
  const migrations = store.core.read('SchemaMigrations')?.rows;
  if (!migrations) throw new JournalError();
  if (!migrations.some((row) => row[0] === JOURNAL_MIGRATION_ID)) {
    options.beforeWrite?.();
    store.core.writeRow('SchemaMigrations', migrations.length + 2, [
      JOURNAL_MIGRATION_ID,
      JOURNAL_MIGRATION_NAME,
      options.journalChecksum,
      timestamp,
      'system:setupJournal',
      'applied',
    ]);
    store.flush();
  }
  const meta = store.core.read('Meta')?.rows;
  const versionIndex = meta?.findIndex((row) => row[0] === 'schema_version') ?? -1;
  if (versionIndex < 0) throw new JournalError();
  options.beforeWrite?.();
  store.core.writeRow('Meta', versionIndex + 2, ['schema_version', '2', timestamp]);
  store.flush();
  if (!planJournalSchema(store, options).alreadyApplied) throw new JournalError();
  return { ...plan, result: 'applied' as const };
}
