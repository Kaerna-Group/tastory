import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concurrencyProbe } from './concurrency-probe';
import { handleRequest } from '../controllers/handle-request';
import type { AuthData, ConcurrencyCommand } from '@tastory/contracts';

const runId = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
const first: ConcurrencyCommand = {
  action: 'spike.concurrency.write',
  payload: { runId, operationId: randomUUID(), expectedRevision: 0, value: 'first' },
};
const second: ConcurrencyCommand = {
  action: 'spike.concurrency.write',
  payload: { runId, operationId: randomUUID(), expectedRevision: 0, value: 'second' },
};
const read: ConcurrencyCommand = { action: 'spike.concurrency.read', payload: { runId } };
const owner: AuthData = {
  user: { id: 'owner-sub', email: 'chef@gmail.com', name: 'Chef', role: 'owner' },
  expiresAt: '2099-01-01T00:00:00Z',
};
function fixture() {
  let exists = false,
    held = false;
  const rows: string[] = [];
  const persisted: string[] = [];
  const events: string[] = [];
  const range = (row: number, _col: number, length = 1) => ({
    getValue: () => rows[row - 1] ?? '',
    getValues: () => rows.slice(row - 1, row - 1 + length).map((value) => [value]),
    setValue: vi.fn((value: string) => {
      expect(held).toBe(true);
      rows[row - 1] = value;
      events.push('write');
    }),
  });
  const sheet = {
    getRange: range,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows.length ? 1 : 0),
  };
  const book = {
    getSheetByName: () => (exists ? sheet : null),
    insertSheet: vi.fn(() => {
      exists = true;
      return sheet;
    }),
  };
  const lock = {
    tryLock: vi.fn(() => {
      expect(held).toBe(false);
      held = true;
      events.push('lock');
      return true;
    }),
    releaseLock: vi.fn(() => {
      held = false;
      events.push('release');
    }),
  };
  const flush = vi.fn(() => {
    expect(held).toBe(true);
    persisted.splice(0, persisted.length, ...rows);
    events.push('flush');
  });
  const properties: Record<string, string> = {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'staging-test-sheet',
  };
  vi.stubGlobal('SpreadsheetApp', { openById: () => book, flush });
  vi.stubGlobal('LockService', { getScriptLock: () => lock });
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({ getProperty: (key: string) => properties[key] ?? null }),
  });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: '' },
    Charset: { UTF_8: '' },
    computeDigest: (_: string, value: string) => [...createHash('sha256').update(value).digest()],
  });
  return { rows, persisted, events, book, lock, flush, properties };
}
let state: ReturnType<typeof fixture>;
beforeEach(() => {
  state = fixture();
});
afterEach(() => vi.unstubAllGlobals());
describe('Sheets concurrency adapter', () => {
  it('one write wins, stale write conflicts, retries preserve receipts and the newer value', () => {
    expect(concurrencyProbe(read, owner).state.revision).toBe(0);
    expect(state.book.insertSheet).not.toHaveBeenCalled();
    expect(concurrencyProbe(first, owner).outcome).toBe('applied');
    expect(concurrencyProbe(second, owner).outcome).toBe('conflict');
    expect(concurrencyProbe(first, owner).outcome).toBe('replayed');
    expect(state.rows).toHaveLength(2);
    if (second.action !== 'spike.concurrency.write') throw new Error();
    const retry: ConcurrencyCommand = {
      ...second,
      payload: { ...second.payload, expectedRevision: 1, operationId: randomUUID() },
    };
    expect(concurrencyProbe(retry, owner)).toMatchObject({
      outcome: 'applied',
      state: { revision: 2, value: 'second' },
      appliedOperations: 2,
    });
    expect(concurrencyProbe(first, owner)).toMatchObject({
      outcome: 'replayed',
      state: { revision: 2, value: 'second' },
      operationRevision: 1,
    });
    expect(concurrencyProbe(read, owner).appliedOperations).toBe(2);
    expect(state.rows).toEqual(state.persisted);
    expect(state.book.insertSheet).toHaveBeenCalledOnce();
    expect(state.events.join(',')).not.toContain('write,release');
  });
  it('isolates owners with the same run ID and rejects mismatched duplicate operations', () => {
    concurrencyProbe(first, owner);
    const other: AuthData = { ...owner, user: { ...owner.user, id: 'another-sub' } };
    expect(concurrencyProbe(read, other).state.revision).toBe(0);
    concurrencyProbe(second, other);
    expect(state.rows).toHaveLength(3);
    if (first.action !== 'spike.concurrency.write') throw new Error();
    expect(() =>
      concurrencyProbe({ ...first, payload: { ...first.payload, value: 'second' } }, owner),
    ).toThrow('OPERATION_MISMATCH');
    expect(concurrencyProbe(read, owner).state.value).toBe('first');
  });
  it('rejects viewer, expiry and production before touching Sheets', () => {
    expect(() =>
      concurrencyProbe(first, { ...owner, user: { ...owner.user, role: 'viewer' } }),
    ).toThrow('ACCESS_DENIED');
    expect(() => concurrencyProbe(first, { ...owner, expiresAt: '2000-01-01T00:00:00Z' })).toThrow(
      'UNAUTHENTICATED',
    );
    state.properties['APP_ENV'] = 'production';
    expect(() => concurrencyProbe(first, owner)).toThrow('PROBE_UNAVAILABLE');
    expect(state.rows).toHaveLength(0);
  });
  it('does not overwrite an unknown sheet, corrupt row or duplicate identity', () => {
    state.book.insertSheet();
    state.rows.push('unrelated data');
    expect(() => concurrencyProbe(first, owner)).toThrow('PROBE_UNAVAILABLE');
    expect(state.rows).toEqual(['unrelated data']);
    state.rows.splice(0);
    state.rows.push('tastory.concurrency.v1');
    concurrencyProbe(first, owner);
    const row = state.rows[1] ?? '';
    state.rows.push(row);
    expect(() => concurrencyProbe(read, owner)).toThrow('PROBE_UNAVAILABLE');
    state.rows[2] = '{broken';
    expect(() => concurrencyProbe(read, owner)).toThrow('PROBE_UNAVAILABLE');
  });
  it('handles lost flush responses without duplicate writes and releases the lock', () => {
    concurrencyProbe(first, owner);
    if (second.action !== 'spike.concurrency.write') throw new Error();
    const command: ConcurrencyCommand = {
      ...second,
      payload: { ...second.payload, expectedRevision: 1 },
    };
    state.flush.mockImplementationOnce(() => {
      throw new Error('flush response lost');
    });
    expect(() => concurrencyProbe(command, owner)).toThrow('PROBE_UNAVAILABLE');
    expect(concurrencyProbe(command, owner)).toMatchObject({
      outcome: 'replayed',
      appliedOperations: 2,
    });
    expect(state.events[state.events.length - 1]).toBe('release');
  });
  it('bounds rows and still permits retry/read at the limit', () => {
    for (let i = 0; i < 100; i++) {
      if (first.action !== 'spike.concurrency.write') throw new Error();
      concurrencyProbe(
        { ...first, payload: { ...first.payload, runId: i ? randomUUID() : runId } },
        owner,
      );
    }
    expect(concurrencyProbe(first, owner).outcome).toBe('replayed');
    if (first.action !== 'spike.concurrency.write') throw new Error();
    expect(() =>
      concurrencyProbe({ ...first, payload: { ...first.payload, runId: randomUUID() } }, owner),
    ).toThrow('PROBE_LIMIT');
    expect(state.rows).toHaveLength(101);
  });
  it('authenticates each route without joining and sanitizes adapter failures', () => {
    const authenticate = vi.fn(() => owner),
      concurrency = vi.fn(concurrencyProbe);
    const context = {
      now: () => new Date(),
      createRequestId: () => runId,
      isEchoEnabled: false,
      deploymentVersion: 'test',
      authenticate,
      concurrency,
    };
    const request = { apiVersion: 1, requestId: runId, ...read, credential: 'synthetic' };
    expect(handleRequest(request, context)).toMatchObject({ ok: true, data: { outcome: 'read' } });
    expect(authenticate).toHaveBeenCalledWith('synthetic', false);
    expect(handleRequest({ ...request, credential: undefined }, context)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(
      handleRequest({ ...request, payload: { runId, ownerKey: 'other' } }, context),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    state.lock.tryLock.mockReturnValue(false);
    expect(handleRequest(request, context)).toMatchObject({ error: { code: 'PROBE_UNAVAILABLE' } });
  });
});
