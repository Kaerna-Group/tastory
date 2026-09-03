import {
  CORE_META_KEYS,
  CORE_MIGRATION_ID,
  CORE_MIGRATION_NAME,
  CORE_SCHEMA_VERSION,
  CORE_TABLES,
} from '../schema/core-schema';
import type { CoreTableName, SystemTableName } from '../schema/core-schema';

export class SchemaMigrationError extends Error {
  constructor(
    public readonly code: string,
    public readonly table?: CoreTableName,
  ) {
    super(table ? `${code}: ${table}` : code);
  }
}
export type TableSnapshot = Readonly<{
  headers: readonly string[];
  rowCount: number;
  columnCount: number;
  // Only system tables are read beyond row 1. No user data is loaded by migrations.
  rows: readonly (readonly string[])[];
}>;
export type SchemaStore = Readonly<{
  read: (name: CoreTableName) => TableSnapshot | null;
  create: (name: CoreTableName) => void;
  writeRow: (name: CoreTableName, row: number, values: readonly string[]) => void;
  flush: () => void;
}>;
export type MigrationOptions = Readonly<{ checksum: string; driveRootId: string; now: () => Date }>;
type Action = Readonly<{ table: CoreTableName; action: 'create' | 'initialize' | 'keep' }>;
export type SchemaPlan = Readonly<{
  fromVersion: number;
  toVersion: 1;
  migrationId: string;
  actions: readonly Action[];
  alreadyApplied: boolean;
}>;

function keyedRows(store: SchemaStore, name: SystemTableName): Map<string, readonly string[]> {
  const rows = store.read(name)?.rows ?? [];
  const result = new Map<string, readonly string[]>();
  for (const row of rows) {
    const key = row[0];
    if (!key || key.trim() !== key || result.has(key))
      throw new SchemaMigrationError('INVALID_SYSTEM_ROWS', name);
    result.set(key, row);
  }
  return result;
}
function validDate(value: string | undefined): boolean {
  return (
    !!value &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function planCoreSchema(store: SchemaStore, options: MigrationOptions): SchemaPlan {
  if (!/^[a-f0-9]{64}$/.test(options.checksum) || !/^[\w-]{1,200}$/.test(options.driveRootId))
    throw new SchemaMigrationError('INVALID_MIGRATION_CONFIG');
  const actions: Action[] = CORE_TABLES.map(({ name, columns }) => {
    const sheet = store.read(name);
    if (!sheet) return { table: name, action: 'create' };
    if (sheet.rowCount === 0 && sheet.columnCount === 0)
      return { table: name, action: 'initialize' };
    if (
      sheet.columnCount !== columns.length ||
      sheet.headers.length !== columns.length ||
      columns.some((column, i) => sheet.headers[i] !== column)
    )
      throw new SchemaMigrationError('HEADER_CONFLICT', name);
    return { table: name, action: 'keep' };
  });
  const meta = keyedRows(store, 'Meta');
  const version = meta.get('schema_version')?.[1] ?? '0';
  if (!/^(0|[1-9]\d*)$/.test(version))
    throw new SchemaMigrationError('INVALID_SCHEMA_VERSION', 'Meta');
  if (Number(version) > CORE_SCHEMA_VERSION) throw new SchemaMigrationError('NEWER_SCHEMA', 'Meta');
  for (const [key, row] of meta) {
    if (row.length !== 3 || !validDate(row[2]))
      throw new SchemaMigrationError('INVALID_SYSTEM_ROWS', 'Meta');
    const value = row[1];
    if (
      (key === 'api_version' && value !== '1') ||
      (key === 'data_revision' && (!value || !/^(0|[1-9]\d*)$/.test(value))) ||
      (key === 'created_at' && !validDate(value)) ||
      (key === 'drive_root_folder_id' && value !== options.driveRootId) ||
      (key === 'maintenance_mode' && value !== 'true' && value !== 'false')
    )
      throw new SchemaMigrationError('META_CONFLICT', 'Meta');
  }
  const migrations = keyedRows(store, 'SchemaMigrations');
  if ([...migrations.keys()].some((key) => key !== CORE_MIGRATION_ID))
    throw new SchemaMigrationError('UNKNOWN_MIGRATION', 'SchemaMigrations');
  const record = migrations.get(CORE_MIGRATION_ID);
  if (
    record &&
    (record.length !== 6 ||
      record[1] !== CORE_MIGRATION_NAME ||
      record[2] !== options.checksum ||
      !validDate(record[3]) ||
      record[4] !== 'system:setupStagingSchema' ||
      !['applied', 'failed'].includes(record[5] ?? ''))
  )
    throw new SchemaMigrationError('MIGRATION_CONFLICT', 'SchemaMigrations');
  const complete =
    actions.every(({ action }) => action === 'keep') &&
    CORE_META_KEYS.every((key) => meta.has(key));
  if (version === '1' && (!complete || record?.[5] !== 'applied'))
    throw new SchemaMigrationError('SCHEMA_DRIFT');
  if (record?.[5] === 'applied' && !complete) throw new SchemaMigrationError('SCHEMA_DRIFT');
  return {
    fromVersion: Number(version),
    toVersion: CORE_SCHEMA_VERSION,
    migrationId: CORE_MIGRATION_ID,
    actions,
    alreadyApplied: version === '1',
  };
}

function upsert(store: SchemaStore, name: SystemTableName, key: string, values: readonly string[]) {
  const rows = store.read(name)?.rows ?? [];
  const index = rows.findIndex((row) => row[0] === key);
  store.writeRow(name, index < 0 ? rows.length + 2 : index + 2, values);
}

export function applyCoreSchema(store: SchemaStore, options: MigrationOptions) {
  const plan = planCoreSchema(store, options); // Complete preflight before the first write.
  if (plan.alreadyApplied) return { ...plan, result: 'already-applied' as const };
  const timestamp = options.now().toISOString();
  const defaults: Record<(typeof CORE_META_KEYS)[number], string> = {
    schema_version: '0',
    api_version: '1',
    data_revision: '0',
    created_at: timestamp,
    drive_root_folder_id: options.driveRootId,
    maintenance_mode: 'false',
  };
  const migrationRow = (status: 'applied' | 'failed') => [
    CORE_MIGRATION_ID,
    CORE_MIGRATION_NAME,
    options.checksum,
    timestamp,
    'system:setupStagingSchema',
    status,
  ];
  try {
    for (const action of plan.actions) {
      if (action.action === 'keep') continue;
      if (action.action === 'create') store.create(action.table);
      const definition = CORE_TABLES.find(({ name }) => name === action.table);
      if (!definition) throw new SchemaMigrationError('UNKNOWN_TABLE');
      store.writeRow(action.table, 1, definition.columns);
    }
    const currentMeta = keyedRows(store, 'Meta');
    for (const key of CORE_META_KEYS) {
      if (!currentMeta.has(key)) upsert(store, 'Meta', key, [key, defaults[key], timestamp]);
    }
    // Log first, flush, then advance schema_version. A lost response can be retried.
    upsert(store, 'SchemaMigrations', CORE_MIGRATION_ID, migrationRow('applied'));
    store.flush();
    upsert(store, 'Meta', 'schema_version', ['schema_version', '1', timestamp]);
    store.flush();
    if (!planCoreSchema(store, options).alreadyApplied)
      throw new SchemaMigrationError('VERIFY_FAILED');
    return { ...plan, result: 'applied' as const };
  } catch (error) {
    try {
      // If the checkpoint actually committed before a lost response, keep its applied log.
      const version = keyedRows(store, 'Meta').get('schema_version')?.[1];
      const log = store.read('SchemaMigrations');
      if (version !== '1' && log?.headers[0] === 'migration_id') {
        upsert(store, 'SchemaMigrations', CORE_MIGRATION_ID, migrationRow('failed'));
        store.flush();
      }
    } catch {
      /* The next run reads the persisted state; never roll back by deleting data. */
    }
    if (error instanceof SchemaMigrationError) throw error;
    throw new SchemaMigrationError('SCHEMA_WRITE_FAILED');
  }
}
