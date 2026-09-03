import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthData, JournalAction } from '@tastory/contracts';
import { journalResponseSchema } from '@tastory/contracts';
import { applyCoreSchema } from './core-migration';
import { applyJournalSchema, planJournalSchema } from './journal-migration';
import { readJournal, runJournalCheck } from './operation-journal';
import { createJournalStore } from '../platform/journal-store';
import { operationJournal } from '../platform/operation-journal';
import { readAdminDirectory } from '../platform/admin-directory';
import { authenticateSheets } from '../platform/workspace-directory';
import { handleRequest } from '../controllers/handle-request';
import { CORE_SCHEMA_FINGERPRINT, CORE_TABLES } from '../schema/core-schema';
import {
  JOURNAL_LIMIT,
  JOURNAL_MIGRATION_ID,
  JOURNAL_SCHEMA_FINGERPRINT,
} from '../schema/journal-schema';

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

function fixture() {
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
    getSheetByName(name: string) {
      const rows = sheets.get(name);
      if (!rows) return null;
      return {
        getLastRow: () => rows.length,
        getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
        getRange(row: number, _column: number, height: number, width: number) {
          const range = {
            getValues: () =>
              Array.from({ length: height }, (_, i) =>
                Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[j] ?? ''),
              ),
            getFormulas: () => (formulas.has(name) ? [['=SECRET()']] : []),
            setNumberFormat: () => range,
            setValues: (values: string[][]) => {
              mutate(() => {
                values.forEach((value, i) => {
                  rows[row - 1 + i] = [...value];
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
    DigestAlgorithm: { SHA_256: 'sha' },
    Charset: { UTF_8: 'utf' },
    computeDigest: (_algorithm: string, value: string) =>
      Array.from(Buffer.from(sha256(value), 'hex')),
  });
  return {
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('journal migration 002', () => {
  it('preserves migration 001 and business data, plans without writes and repeats without writes', () => {
    const state = fixture();
    const original = CORE_TABLES.filter(
      (table) => table.name !== 'Meta' && table.name !== 'SchemaMigrations',
    ).map((table) => state.required(table.name));
    const before = JSON.stringify(original);
    expect(planJournalSchema(state.store, options)).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      alreadyApplied: false,
    });
    expect(state.count()).toBe(0);
    const firstMigration = [...(state.required('SchemaMigrations')[1] ?? [])];
    expect(applyJournalSchema(state.store, options).result).toBe('applied');
    expect(state.count()).toBe(8);
    expect(JSON.stringify(original)).toBe(before);
    expect(state.required('SchemaMigrations')[1]).toEqual(firstMigration);
    expect(state.required('Meta').find((row) => row[0] === 'data_revision')?.[1]).toBe('1');
    state.fail();
    expect(applyJournalSchema(state.store, options).result).toBe('already-applied');
    expect(state.count()).toBe(0);
  });
  it.each(Array.from({ length: 8 }, (_, index) => index + 1))(
    'recovers interruption before/after migration mutation %i',
    (at) => {
      for (const after of [false, true]) {
        const state = fixture();
        state.fail(at, after);
        expect(() => applyJournalSchema(state.store, options)).toThrow();
        state.fail();
        applyJournalSchema(state.store, options);
        expect(planJournalSchema(state.store, options).alreadyApplied).toBe(true);
        expect(
          state.required('SchemaMigrations').filter((row) => row[0] === JOURNAL_MIGRATION_ID),
        ).toHaveLength(1);
        expect(state.required('Operations')).toHaveLength(1);
      }
    },
  );
  it('refuses renamed tables, unrelated contents, bad migration checksums and future versions', () => {
    const state = fixture();
    state.sheets.set('Operations', [['unrelated'], ['do-not-overwrite']]);
    expect(() => applyJournalSchema(state.store, options)).toThrow();
    expect(state.count()).toBe(0);
    state.sheets.delete('Operations');
    applyJournalSchema(state.store, options);
    const migration = state
      .required('SchemaMigrations')
      .find((row) => row[0] === JOURNAL_MIGRATION_ID);
    if (!migration) throw new Error();
    migration[2] = 'b'.repeat(64);
    expect(() => planJournalSchema(state.store, options)).toThrow();
    migration[2] = options.journalChecksum;
    const version = state.required('Meta').find((row) => row[0] === 'schema_version');
    if (!version) throw new Error();
    version[1] = '3';
    expect(() => planJournalSchema(state.store, options)).toThrow();
  });
  it('rejects inconsistent version 2 and does not hide unknown or damaged core migrations', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    const original = [...state.required('SchemaMigrations')];
    state.required('SchemaMigrations').pop();
    expect(() => planJournalSchema(state.store, options)).toThrow();
    state.sheets.set('SchemaMigrations', original);
    state.required('SchemaMigrations').push(['003-unknown', '', '', '', '', '']);
    expect(() => planJournalSchema(state.store, options)).toThrow();
    state.required('SchemaMigrations').pop();
    state.sheets.delete('AuditLog');
    expect(() => applyJournalSchema(state.store, options)).toThrow();
  });
});

describe('resumable operation and append-only audit', () => {
  it('returns the saved result on replay, including after a newer operation, without touching audit', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    state.fail();
    expect(runJournalCheck(state.store, identity, runOptions).outcome).toBe('committed');
    expect(state.count()).toBe(6);
    const first = readJournal(state.store);
    runJournalCheck(state.store, { ...identity, requestId: other }, runOptions);
    state.fail();
    const repeated = runJournalCheck(state.store, identity, runOptions);
    expect(repeated.outcome).toBe('replayed');
    expect(repeated.operation).toEqual(first.operations[0]);
    expect(readJournal(state.store).audit[0]).toEqual(first.audit[0]);
    expect(state.count()).toBe(0);
  });
  it.each([1, 2, 3, 4, 5, 6])(
    'recovers a failure before/after journal mutation %i with one operation and one audit event',
    (at) => {
      for (const after of [false, true]) {
        const state = fixture();
        applyJournalSchema(state.store, options);
        state.fail(at, after);
        expect(() => runJournalCheck(state.store, identity, runOptions)).toThrow();
        state.fail();
        const result = runJournalCheck(state.store, identity, runOptions);
        expect(result.operation.status).toBe('committed');
        const rows = readJournal(state.store);
        expect(rows.operations).toHaveLength(1);
        expect(rows.audit).toHaveLength(1);
        state.fail();
        expect(runJournalCheck(state.store, identity, runOptions).outcome).toBe('replayed');
        expect(state.count()).toBe(0);
      }
    },
  );
  it('rejects reuse by another actor/workspace or with a different hash without leaking saved data', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    runJournalCheck(state.store, identity, runOptions);
    state.fail();
    for (const input of [
      { ...identity, userId: viewer },
      { ...identity, workspaceId: other },
    ])
      expect(() => runJournalCheck(state.store, input, runOptions)).toThrow('OPERATION_MISMATCH');
    expect(() =>
      runJournalCheck(state.store, identity, { ...runOptions, sha256: () => 'b'.repeat(64) }),
    ).toThrow('OPERATION_MISMATCH');
    expect(state.count()).toBe(0);
  });
  it('rejects duplicate operations, orphan audit records and committed entries with missing audit', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    runJournalCheck(state.store, identity, runOptions);
    const operation = state.required('Operations')[1];
    if (!operation) throw new Error();
    state.required('Operations').push([...operation]);
    expect(() => readJournal(state.store)).toThrow();
    state.required('Operations').pop();
    const audit = state.required('AuditLog')[1];
    if (!audit) throw new Error();
    audit[0] = other;
    audit[1] = other;
    expect(() => readJournal(state.store)).toThrow();
    state.required('AuditLog').pop();
    expect(() => readJournal(state.store)).toThrow();
  });
  it('stops after expiry before further writes, then resumes using fresh authorization', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    state.fail();
    let checks = 0;
    expect(() =>
      runJournalCheck(state.store, identity, {
        ...runOptions,
        assertAuthorized() {
          if (++checks === 3) throw new Error('expired');
        },
      }),
    ).toThrow('expired');
    expect(readJournal(state.store).operations[0]?.status).toBe('started');
    expect(readJournal(state.store).audit).toHaveLength(0);
    expect(runJournalCheck(state.store, identity, runOptions).operation.status).toBe('committed');
  });
  it('enforces storage bounds and refuses formulas and oversized cells', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    state.formulas.add('AuditLog');
    expect(() => readJournal(state.store)).toThrow();
    state.formulas.clear();
    state.required('Operations').push(['x'.repeat(4097)]);
    expect(() => state.store.readTable('Operations')).toThrow();
    state.required('Operations').pop();
    expect(() => state.store.writeTableRow('AuditLog', 2, ['=bad'])).toThrow();
    while (state.required('Operations').length <= JOURNAL_LIMIT + 1)
      state.required('Operations').push([]);
    expect(() => readJournal(state.store)).toThrow();
  });
});

describe('owner journal HTTP and schema compatibility', () => {
  const session = (role: 'owner' | 'viewer' = 'owner'): AuthData => ({
    user: { id: `${role}-sub`, role, email: `${role}@example.test`, name: role },
    expiresAt: '2050-01-01T00:00:00Z',
  });
  it('initializes once, verifies duplicate requests, and keeps both accounts and health working on schema 2', () => {
    const state = fixture();
    expect(operationJournal('admin.operations.list', requestId, session())).toMatchObject({
      kind: 'list',
      ready: false,
    });
    state.hold();
    expect(operationJournal('admin.operations.initialize', requestId, session())).toMatchObject({
      kind: 'initialized',
      alreadyApplied: false,
    });
    state.fail();
    expect(operationJournal('admin.operations.initialize', requestId, session())).toMatchObject({
      alreadyApplied: true,
    });
    expect(state.count()).toBe(0);
    expect(operationJournal('admin.operations.check', requestId, session())).toMatchObject({
      kind: 'check',
      outcome: 'committed',
    });
    expect(operationJournal('admin.operations.check', requestId, session())).toMatchObject({
      kind: 'check',
      outcome: 'replayed',
    });
    const result = operationJournal('admin.operations.list', other, session());
    expect(result).toMatchObject({
      ready: true,
      total: 1,
      entries: [{ status: 'committed', auditRecorded: true, canRetry: false }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /owner-sub|payload_hash|private-sheet|private-drive|result_json/,
    );
    expect(readAdminDirectory('admin.health', session())).toMatchObject({
      schemaVersion: 2,
      tablesChecked: 8,
      activeMembers: 2,
    });
    for (const role of ['owner', 'viewer'] as const) {
      const auth = session(role);
      expect(
        authenticateSheets(
          {
            sub: auth.user.id,
            email: auth.user.email,
            name: role,
            emailAuthoritative: true,
            expiresAt: auth.expiresAt,
          },
          state.properties.SHEETS_AUTH_CONFIG ?? '',
          'private-sheet',
        ).user.role,
      ).toBe(role);
    }
  });
  it.each([
    'admin.operations.list',
    'admin.operations.initialize',
    'admin.operations.check',
  ] as const)(
    'protects %s from anonymous, viewer, forged owner and injected payloads',
    (action: JournalAction) => {
      const state = fixture();
      const context = {
        now: options.now,
        createRequestId: () => other,
        deploymentVersion: 'test',
        isEchoEnabled: false,
        authenticate: () => session(),
        journal: operationJournal,
      };
      const request = {
        apiVersion: 1,
        action,
        requestId,
        credential: 'validated-in-auth-layer',
        payload: {},
      };
      expect(handleRequest({ ...request, credential: undefined }, context)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
      expect(handleRequest({ ...request, payload: { workspaceId: other } }, context)).toMatchObject(
        { ok: false, error: { code: 'INVALID_REQUEST' } },
      );
      expect(
        handleRequest(request, { ...context, authenticate: () => session('viewer') }),
      ).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
      expect(() =>
        operationJournal(action, requestId, {
          ...session(),
          user: { ...session().user, id: 'viewer-sub' },
        }),
      ).toThrow('ACCESS_DENIED');
      expect(state.count()).toBe(0);
      expect(journalResponseSchema.safeParse(handleRequest(request, context)).success).toBe(true);
    },
  );
  it('rereads revoked ownership, expired tokens and invalid configuration before writes', () => {
    const state = fixture();
    const member = state.required('WorkspaceMembers')[1];
    if (!member) throw new Error();
    member[3] = 'disabled';
    expect(() => operationJournal('admin.operations.initialize', requestId, session())).toThrow(
      'ACCESS_DENIED',
    );
    member[3] = 'active';
    expect(() =>
      operationJournal('admin.operations.initialize', requestId, {
        ...session(),
        expiresAt: '2000-01-01T00:00:00Z',
      }),
    ).toThrow('UNAUTHENTICATED');
    state.properties.SHEETS_AUTH_CONFIG = '{}';
    expect(() => operationJournal('admin.operations.initialize', requestId, session())).toThrow(
      'JOURNAL_UNAVAILABLE',
    );
    expect(state.count()).toBe(0);
    state.lock.mockReturnValue(false);
    state.release.mockClear();
    expect(() => operationJournal('admin.operations.list', requestId, session())).toThrow();
    expect(state.release).not.toHaveBeenCalled();
  });
  it('shows interrupted entries as resumable only to their actor', () => {
    const state = fixture();
    applyJournalSchema(state.store, options);
    state.fail(3);
    expect(() => runJournalCheck(state.store, identity, runOptions)).toThrow();
    state.fail();
    expect(operationJournal('admin.operations.list', other, session())).toMatchObject({
      entries: [{ status: 'started', canRetry: true, auditRecorded: false }],
    });
    expect(operationJournal('admin.operations.check', requestId, session())).toMatchObject({
      outcome: 'committed',
    });
  });
});
