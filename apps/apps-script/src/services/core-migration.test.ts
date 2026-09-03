import { describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import { CORE_META_KEYS, CORE_TABLES } from '../schema/core-schema';
import type { CoreTableName } from '../schema/core-schema';
import { applyCoreSchema, planCoreSchema } from './core-migration';
import type { SchemaStore } from './core-migration';

const timestamp = '2026-09-03T12:00:00.000Z';
function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
const options = {
  checksum: 'a'.repeat(64),
  driveRootId: 'test-drive',
  now: () => new Date(timestamp),
};
function memoryStore() {
  const sheets = new Map<string, string[][]>();
  let mutations = 0;
  let failAt = 0;
  let failAfterWrite = false;
  function mutate(write: () => void) {
    mutations += 1;
    if (mutations === failAt && !failAfterWrite) throw new Error('simulated interruption');
    write();
    if (mutations === failAt && failAfterWrite) throw new Error('simulated lost response');
  }
  const store: SchemaStore = {
    read(name) {
      const values = sheets.get(name);
      if (!values) return null;
      return {
        headers: [...(values[0] ?? [])],
        rowCount: values.length,
        columnCount: Math.max(0, ...values.map((row) => row.length)),
        rows:
          name === 'Meta' || name === 'SchemaMigrations' ? values.slice(1).map((r) => [...r]) : [],
      };
    },
    create: (name) =>
      mutate(() => {
        if (sheets.has(name)) throw new Error('sheet exists');
        sheets.set(name, []);
      }),
    writeRow: (name, row, values) =>
      mutate(() => {
        const sheet = sheets.get(name);
        if (!sheet) throw new Error('missing sheet');
        sheet[row - 1] = [...values];
      }),
    flush: () => mutate(() => {}),
  };
  return {
    store,
    sheets,
    count: () => mutations,
    fail: (at: number, after: boolean) => {
      failAt = at;
      failAfterWrite = after;
    },
  };
}
function expectComplete(state: ReturnType<typeof memoryStore>) {
  expect(planCoreSchema(state.store, options).alreadyApplied).toBe(true);
  for (const { name, columns } of CORE_TABLES) expect(state.sheets.get(name)?.[0]).toEqual(columns);
  const meta = new Map(
    state.sheets
      .get('Meta')
      ?.slice(1)
      .map((row) => [row[0], row[1]]),
  );
  expect(meta.size).toBe(CORE_META_KEYS.length);
  expect(meta.get('schema_version')).toBe('1');
  expect(meta.get('drive_root_folder_id')).toBe(options.driveRootId);
  expect(state.sheets.get('SchemaMigrations')).toHaveLength(2);
  expect(state.sheets.get('SchemaMigrations')?.[1]?.[5]).toBe('applied');
}

describe('core schema migration', () => {
  it('plans without writes and creates complete tables once', () => {
    const state = memoryStore();
    expect(planCoreSchema(state.store, options)).toMatchObject({
      fromVersion: 0,
      toVersion: 1,
      alreadyApplied: false,
    });
    expect(state.count()).toBe(0);
    expect(applyCoreSchema(state.store, options).result).toBe('applied');
    expectComplete(state);
    const before = JSON.stringify([...state.sheets]);
    const count = state.count();
    expect(applyCoreSchema(state.store, options).result).toBe('already-applied');
    expect(state.count()).toBe(count);
    expect(JSON.stringify([...state.sheets])).toBe(before);
  });
  it('keeps existing business rows, custom metadata and unrelated sheets intact', () => {
    const state = memoryStore();
    const users = required(CORE_TABLES.find((table) => table.name === 'Users'));
    const rows = [
      [...users.columns],
      ...Array.from({ length: 3 }, () => users.columns.map(() => 'private-value')),
    ];
    state.sheets.set('Users', structuredClone(rows));
    state.sheets.set('Meta', [
      ['key', 'value', 'updated_at'],
      ['custom_setting', 'preserve', timestamp],
      ['data_revision', '17', timestamp],
    ]);
    state.sheets.set('Sheet1', [['unrelated', '=SUM(1,2)']]);
    state.sheets.set('Invites', []);
    expect(planCoreSchema(state.store, options).actions).toContainEqual({
      table: 'Invites',
      action: 'initialize',
    });
    applyCoreSchema(state.store, options);
    expect(state.sheets.get('Users')).toEqual(rows);
    expect(state.sheets.get('Meta')).toContainEqual(['custom_setting', 'preserve', timestamp]);
    expect(state.sheets.get('Meta')).toContainEqual(['data_revision', '17', timestamp]);
    expect(state.sheets.get('Sheet1')).toEqual([['unrelated', '=SUM(1,2)']]);
  });
  it('checks the last table before creating any missing earlier table', () => {
    const state = memoryStore();
    state.sheets.set('WorkspaceMembers', [['unexpected-header']]);
    expect(() => applyCoreSchema(state.store, options)).toThrow(
      'HEADER_CONFLICT: WorkspaceMembers',
    );
    expect(state.count()).toBe(0);
    expect(state.sheets.size).toBe(1);
  });
  it.each([false, true])(
    'recovers from interruption at every write/flush (after write = %s)',
    (after) => {
      const baseline = memoryStore();
      applyCoreSchema(baseline.store, options);
      for (let step = 1; step <= baseline.count(); step += 1) {
        const state = memoryStore();
        state.fail(step, after);
        expect(() => applyCoreSchema(state.store, options), `step ${step}`).toThrow(
          'SCHEMA_WRITE_FAILED',
        );
        applyCoreSchema(state.store, options);
        expectComplete(state);
      }
    },
  );
  it('logs failure and retries the same migration without duplicate log rows', () => {
    const state = memoryStore();
    state.fail(5, false); // Both system headers are durable; creating Users fails.
    expect(() => applyCoreSchema(state.store, options)).toThrow('SCHEMA_WRITE_FAILED');
    expect(state.sheets.get('SchemaMigrations')?.[1]?.[5]).toBe('failed');
    applyCoreSchema(state.store, options);
    expectComplete(state);
  });
  it('finishes an applied log whose final version checkpoint was not persisted', () => {
    const state = memoryStore();
    applyCoreSchema(state.store, options);
    const version = required(
      required(state.sheets.get('Meta')).find((row) => row[0] === 'schema_version'),
    );
    version[1] = '0';
    expect(applyCoreSchema(state.store, options).result).toBe('applied');
    expectComplete(state);
  });
  it.each([
    ['schema_version', '2', 'NEWER_SCHEMA'],
    ['schema_version', 'garbage', 'INVALID_SCHEMA_VERSION'],
    ['drive_root_folder_id', 'different-drive', 'META_CONFLICT'],
    ['api_version', '2', 'META_CONFLICT'],
    ['data_revision', '-1', 'META_CONFLICT'],
    ['maintenance_mode', 'maybe', 'META_CONFLICT'],
    ['created_at', 'yesterday', 'META_CONFLICT'],
  ])('rejects incompatible metadata %s before changes', (key, value, code) => {
    const state = memoryStore();
    state.sheets.set('Meta', [
      ['key', 'value', 'updated_at'],
      [key, value, timestamp],
    ]);
    expect(() => applyCoreSchema(state.store, options)).toThrow(code);
    expect(state.count()).toBe(0);
  });
  it.each(['Meta', 'SchemaMigrations'] as const)('rejects duplicate keys in %s', (name) => {
    const state = memoryStore();
    applyCoreSchema(state.store, options);
    required(state.sheets.get(name)).push([...required(state.sheets.get(name)?.[1])]);
    const count = state.count();
    expect(() => applyCoreSchema(state.store, options)).toThrow('INVALID_SYSTEM_ROWS');
    expect(state.count()).toBe(count);
  });
  it('rejects edited migration definitions and unknown history', () => {
    const state = memoryStore();
    applyCoreSchema(state.store, options);
    const count = state.count();
    expect(() => applyCoreSchema(state.store, { ...options, checksum: 'b'.repeat(64) })).toThrow(
      'MIGRATION_CONFLICT',
    );
    required(state.sheets.get('SchemaMigrations')?.[1])[0] = 'unknown-migration';
    expect(() => applyCoreSchema(state.store, options)).toThrow('UNKNOWN_MIGRATION');
    expect(state.count()).toBe(count);
  });
  it.each(['Users', 'SchemaMigrations'] as CoreTableName[])(
    'refuses to recreate deleted %s after checkpoint 1',
    (table) => {
      const state = memoryStore();
      applyCoreSchema(state.store, options);
      state.sheets.delete(table);
      const count = state.count();
      expect(() => applyCoreSchema(state.store, options)).toThrow('SCHEMA_DRIFT');
      expect(state.count()).toBe(count);
    },
  );
});
