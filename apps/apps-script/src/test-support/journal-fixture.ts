import { createHash, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { applyCoreSchema } from '../services/core-migration';
import { createJournalStore } from '../platform/journal-store';
import { CORE_SCHEMA_FINGERPRINT } from '../schema/core-schema';
import { JOURNAL_SCHEMA_FINGERPRINT } from '../schema/journal-schema';
const owner = '11111111-1111-4111-8111-111111111111';
const viewer = '22222222-2222-4222-8222-222222222222';
const workspace = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2026-09-03T12:00:00.000Z';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const options = {
  checksum: sha256(CORE_SCHEMA_FINGERPRINT),
  journalChecksum: sha256(JOURNAL_SCHEMA_FINGERPRINT),
  driveRootId: 'private-drive',
  now: () => new Date(timestamp),
};
const identity = { requestId, userId: owner, workspaceId: workspace };
const runOptions = { now: options.now, sha256, assertAuthorized: () => {} };

export function fixture() {
  const sheets = new Map<string, string[][]>();
  let count = 0,
    failAt = 0,
    failAfter = false;
  let locked = true;
  const formulas = new Set<string>();
  const mutate = (write: () => void) => {
    expect(locked).toBe(true);
    count += 1;
    if (count === failAt && !failAfter) throw new Error('interrupted before write');
    write();
    if (count === failAt && failAfter) throw new Error('lost write response');
  };
  const book = {
    getId: () => 'private-sheet',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/private-sheet/edit',
    getSheets(): unknown[] {
      return [...sheets.keys()].map((name) => book.getSheetByName(name));
    },
    getSheetByName(name: string) {
      const rows = sheets.get(name);
      if (!rows) return null;
      return {
        getName: () => name,
        getMaxColumns: () => 26,
        insertColumnsAfter: () => mutate(() => {}),
        getMaxRows: () => Math.max(1000, rows.length),
        insertRowsAfter: () => mutate(() => {}),
        deleteRows: (row: number, count: number) =>
          mutate(() => {
            rows.splice(row - 1, count);
          }),
        getLastRow: () => rows.length,
        getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
        getRange(row: number, column: number, height: number, width: number) {
          const range = {
            getValues: () =>
              Array.from({ length: height }, (_, i) =>
                Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? ''),
              ),
            getFormulas: () => (formulas.has(name) ? [['=SECRET()']] : []),
            setNumberFormat: () => range,
            setValues: (values: string[][]) => {
              mutate(() => {
                values.forEach((value, i) => {
                  const target = rows[row - 1 + i] ?? [];
                  value.forEach((cell, j) => {
                    target[column - 1 + j] = cell;
                  });
                  rows[row - 1 + i] = target;
                });
              });
              return range;
            },
          };
          return range;
        },
      };
    },
    insertSheet(name: string) {
      mutate(() => {
        if (sheets.has(name)) throw new Error('duplicate table');
        sheets.set(name, []);
      });
    },
  };
  vi.stubGlobal('SpreadsheetApp', { openById: () => book, flush: () => mutate(() => {}) });
  const store = createJournalStore(book as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet);
  applyCoreSchema(store.core, options);
  const required = (name: string) => {
    const value = sheets.get(name);
    if (!value) throw new Error('missing fixture');
    return value;
  };
  for (const [userId, subject, email] of [
    [owner, 'owner-sub', 'owner@example.test'],
    [viewer, 'viewer-sub', 'viewer@example.test'],
  ] as const) {
    required('Users').push([userId, subject, email, email, '', '', 'active', timestamp, '', '1']);
  }
  required('Workspaces').push([workspace, 'Книга', owner, '', '', timestamp, timestamp, '1']);
  required('WorkspaceMembers').push(
    [workspace, owner, 'owner', 'active', timestamp, '1'],
    [workspace, viewer, 'viewer', 'active', timestamp, '1'],
  );
  const metaRevision = required('Meta').find((row) => row[0] === 'data_revision');
  if (!metaRevision) throw new Error();
  metaRevision[1] = '1';
  required('Meta').push([
    'users_import_v1',
    JSON.stringify({
      version: 1,
      state: 'applied',
      sourceHash: 'a'.repeat(64),
      createdAt: timestamp,
      baseRevision: 0,
      ids: [owner, viewer, workspace],
    }),
    timestamp,
  ]);
  count = 0;
  const properties: Record<string, string> = {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'private-sheet',
    DRIVE_FOLDER_ID: 'private-drive',
    SHEETS_AUTH_CONFIG: JSON.stringify({ version: 1, backend: 'sheets', workspaceId: workspace }),
  };
  const release = vi.fn(() => {
    locked = false;
  });
  const lock = vi.fn(() => {
    locked = true;
    return true;
  });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock: lock, releaseLock: release }) });
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({ getProperty: (key: string) => properties[key] ?? null }),
  });
  vi.stubGlobal('Utilities', {
    getUuid: randomUUID,
    DigestAlgorithm: { SHA_256: 'sha' },
    Charset: { UTF_8: 'utf' },
    computeDigest: (_algorithm: string, value: string) =>
      Array.from(Buffer.from(sha256(value), 'hex')),
  });
  return {
    book: book as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet,
    store,
    sheets,
    required,
    formulas,
    properties,
    lock,
    release,
    count: () => count,
    fail(at = 0, after = false) {
      count = 0;
      failAt = at;
      failAfter = after;
    },
    hold() {
      locked = true;
    },
  };
}

export {
  owner,
  viewer,
  workspace,
  other,
  requestId,
  timestamp,
  sha256,
  options,
  identity,
  runOptions,
};
