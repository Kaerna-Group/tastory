import type { SchemaStore, TableSnapshot, MigrationOptions } from './core-migration';
import { planCoreSchema } from './core-migration';
import {
  JOURNAL_MIGRATION_ID,
  JOURNAL_MIGRATION_NAME,
  JOURNAL_TABLES,
} from '../schema/journal-schema';
import type { JournalTableName } from '../schema/journal-schema';
import { JournalError } from './journal-error';

export type JournalStore = {
  core: SchemaStore;
  readTable: (name: JournalTableName) => TableSnapshot | null;
  createTable: (name: JournalTableName) => void;
  writeTableRow: (name: JournalTableName, row: number, values: readonly string[]) => void;
  flush: () => void;
};
export type JournalMigrationOptions = MigrationOptions & {
  journalChecksum: string;
  beforeWrite?: () => void;
};

export function planJournalSchema(store: JournalStore, options: JournalMigrationOptions) {
  if (!/^[a-f0-9]{64}$/.test(options.journalChecksum)) throw new JournalError();
  const meta = store.core.read('Meta');
  const log = store.core.read('SchemaMigrations');
  const version = meta?.rows.find((row) => row[0] === 'schema_version')?.[1];
  if (!meta || !log || (version !== '1' && version !== '2')) throw new JournalError();
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
        const rows = log.rows.filter((row) => row[0] !== JOURNAL_MIGRATION_ID);
        return { ...log, rows, rowCount: rows.length + 1 };
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
  if ((version === '2' || record) && actions.some(({ action }) => action !== 'keep'))
    throw new JournalError();
  if (version === '2' && !record) throw new JournalError();
  return {
    fromVersion: Number(version),
    toVersion: 2 as const,
    migrationId: JOURNAL_MIGRATION_ID,
    actions,
    alreadyApplied: version === '2',
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
