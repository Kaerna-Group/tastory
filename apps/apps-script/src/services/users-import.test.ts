import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CORE_TABLES } from '../schema/core-schema';
import {
  applyUsersImport,
  planUsersImport,
  IDENTITY_TABLES,
  USERS_IMPORT_KEY,
} from './users-import';
import type { UsersImportStore } from './users-import';

const timestamp = '2026-09-03T10:33:45.000Z';
const joinedAt = '2026-09-02T10:00:00.000Z';
function fixture() {
  const invitations = [
    { email: 'owner@example.test', role: 'owner', expiresAt: '2026-09-09T12:00:00Z' },
    { email: 'viewer@example.test', role: 'viewer', expiresAt: '2026-09-10T12:00:00Z' },
  ];
  const bindings = [
    { email: 'owner@example.test', sub: 'private-owner-sub', joinedAt },
    { email: 'viewer@example.test', sub: 'private-viewer-sub', joinedAt },
  ];
  const options = {
    invitations,
    bindings,
    ownerEmail: 'owner@example.test',
    now: () => new Date(timestamp),
    uuid: randomUUID,
    sha256: (value: string) => createHash('sha256').update(value).digest('hex'),
  };
  const sheets = new Map<string, string[][]>(
    CORE_TABLES.map(({ name, columns }) => [name, [[...columns]]]),
  );
  const meta = sheets.get('Meta');
  assert.ok(meta);
  meta.push(
    ['schema_version', '1', timestamp],
    ['maintenance_mode', 'false', timestamp],
    ['data_revision', '0', timestamp],
  );
  let writes = 0,
    failAt = 0,
    afterWrite = false;
  function mutate(callback: () => void) {
    writes += 1;
    if (writes === failAt && !afterWrite) throw new Error('private-provider-error');
    callback();
    if (writes === failAt && afterWrite) throw new Error('private-lost-response');
  }
  const getRows = (name: string) => {
    const rows = sheets.get(name);
    assert.ok(rows);
    return rows;
  };
  const store: UsersImportStore = {
    read(name) {
      const values = getRows(name);
      return {
        headers: values[0] ?? [],
        rows: values.slice(1),
        rowCount: values.length,
        columnCount: values[0]?.length ?? 0,
      };
    },
    readIdentityRows: (table) =>
      getRows(table)
        .slice(1)
        .map((row) => [...row]),
    create: () => {
      throw new Error('Import must not create sheets');
    },
    writeRow: (table, row, values) =>
      mutate(() => {
        getRows(table)[row - 1] = [...values];
      }),
    flush: () => mutate(() => {}),
  };
  return {
    options,
    store,
    sheets,
    getRows,
    count: () => writes,
    fail: (at: number, after: boolean) => {
      failAt = at;
      afterWrite = after;
    },
    meta: (key: string) => {
      const row = meta.find((entry) => entry[0] === key);
      assert.ok(row);
      return row;
    },
  };
}
function verify(state: ReturnType<typeof fixture>) {
  const result = planUsersImport(state.store, state.options);
  expect(result).toMatchObject({
    alreadyApplied: true,
    users: 2,
    workspaces: 1,
    memberships: 2,
    invitations: 2,
    pendingRows: 0,
    roles: { owner: 1, member: 0, viewer: 1 },
  });
  expect(state.meta('data_revision')[1]).toBe('1');
  const users = state.getRows('Users').slice(1);
  expect(new Set(users.map((row) => row[0])).size).toBe(2);
  expect(users.map((row) => row[1])).toEqual(['private-owner-sub', 'private-viewer-sub']);
  expect(state.getRows('Workspaces')[1]?.[2]).toBe(users[0]?.[0]);
  expect(
    state
      .getRows('WorkspaceMembers')
      .slice(1)
      .map((row) => [row[1], row[2]]),
  ).toEqual(users.map((row, i) => [row[0], i === 0 ? 'owner' : 'viewer']));
}

describe('staging identity import', () => {
  it('previews counts only, imports existing identities and roles, then repeats without writes', () => {
    const state = fixture();
    const sourcesBefore = JSON.stringify([state.options.invitations, state.options.bindings]);
    const report = planUsersImport(state.store, state.options);
    expect(report).toMatchObject({
      users: 2,
      invitations: 2,
      pendingRows: 7,
      alreadyApplied: false,
    });
    expect(JSON.stringify(report)).not.toMatch(/private|@|example/);
    expect(state.count()).toBe(0);
    expect(applyUsersImport(state.store, state.options).result).toBe('applied');
    verify(state);
    const before = JSON.stringify([...state.sheets]),
      writes = state.count();
    expect(applyUsersImport(state.store, state.options).result).toBe('already-applied');
    expect(state.count()).toBe(writes);
    expect(JSON.stringify([...state.sheets])).toBe(before);
    expect(JSON.stringify([state.options.invitations, state.options.bindings])).toBe(sourcesBefore);
    // Checkpoint contains IDs and a digest, not a second copy of emails or Google subjects.
    expect(state.meta(USERS_IMPORT_KEY)[1]).not.toMatch(/private|@|example/);
  });
  it.each([false, true])('recovers before/after every persistence boundary (after=%s)', (after) => {
    const baseline = fixture();
    applyUsersImport(baseline.store, baseline.options);
    for (let step = 1; step <= baseline.count(); step += 1) {
      const state = fixture();
      state.fail(step, after);
      expect(() => applyUsersImport(state.store, state.options), `step ${step}`).toThrow(
        'IMPORT_WRITE_FAILED',
      );
      const ids = state.getRows('Meta').find((row) => row[0] === USERS_IMPORT_KEY)?.[1];
      applyUsersImport(state.store, state.options);
      verify(state);
      if (ids)
        expect(JSON.parse(state.meta(USERS_IMPORT_KEY)[1] ?? '{}').ids).toEqual(
          JSON.parse(ids).ids,
        );
    }
  });
  it('keeps expired claimed membership, expires unused invitations and preserves revoked identity without access', () => {
    const state = fixture();
    state.options.invitations[1] = {
      email: 'viewer@example.test',
      role: 'viewer',
      expiresAt: '2026-01-01T00:00:00Z',
    };
    state.options.invitations.push(
      { email: 'expired@example.test', role: 'member', expiresAt: '2026-01-01T00:00:00Z' },
      { email: 'pending@example.test', role: 'member', expiresAt: '2027-01-01T00:00:00Z' },
    );
    state.options.bindings.push({ email: 'revoked@example.test', sub: 'revoked-sub', joinedAt });
    applyUsersImport(state.store, state.options);
    const statuses = new Map(
      state
        .getRows('Invites')
        .slice(1)
        .map((row) => [row[2], row[8]]),
    );
    expect(statuses.get('viewer@example.test')).toBe('used');
    expect(statuses.get('expired@example.test')).toBe('expired');
    expect(statuses.get('pending@example.test')).toBe('pending');
    const revoked = state.getRows('Users').find((row) => row[1] === 'revoked-sub');
    assert.ok(revoked);
    expect(state.getRows('WorkspaceMembers').some((row) => row[1] === revoked[0])).toBe(false);
  });
  it.each(['another@example.test', ''])(
    'requires the effective owner %s before writing',
    (email) => {
      const state = fixture();
      state.options.ownerEmail = email;
      expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_OWNER_REQUIRED');
      expect(state.count()).toBe(0);
    },
  );
  it('rejects multiple owners or an owner who has never joined', () => {
    const state = fixture();
    state.options.invitations[1] = {
      email: 'viewer@example.test',
      role: 'owner',
      expiresAt: '2027-01-01T00:00:00Z',
    };
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_OWNER_REQUIRED');
    state.options.invitations.pop();
    state.options.bindings.shift();
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_OWNER_REQUIRED');
    expect(state.count()).toBe(0);
  });
  it('rejects malformed registry objects and case-insensitive identity collisions', () => {
    const state = fixture();
    expect(() =>
      applyUsersImport(state.store, { ...state.options, bindings: state.options.invitations }),
    ).toThrow('IMPORT_SOURCE_INVALID');
    state.options.bindings.push({ email: 'OWNER@example.test', sub: 'other-sub', joinedAt });
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_SOURCE_INVALID');
    expect(state.count()).toBe(0);
  });
  it('does not adopt target records without the import checkpoint', () => {
    const state = fixture();
    state.getRows('Invites').push(['existing-data']);
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_TARGET_NOT_EMPTY');
    expect(state.count()).toBe(0);
  });
  it('refuses changed source policy after a partial import', () => {
    const state = fixture();
    state.fail(4, false);
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_WRITE_FAILED');
    const before = JSON.stringify([...state.sheets]);
    state.options.invitations.pop();
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_SOURCE_CHANGED');
    expect(JSON.stringify([...state.sheets])).toBe(before);
  });
  it.each(IDENTITY_TABLES)(
    'rejects duplicates, edits and missing completed data in %s',
    (table) => {
      const state = fixture();
      applyUsersImport(state.store, state.options);
      const rows = state.getRows(table);
      const row = rows[1];
      assert.ok(row);
      rows.push([...row]);
      const count = state.count();
      expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_TARGET_CONFLICT');
      rows.pop();
      row[1] = 'edited';
      expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_TARGET_CONFLICT');
      rows.pop();
      expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_TARGET_CONFLICT');
      expect(state.count()).toBe(count);
    },
  );
  it.each(['garbage', '{}'])('rejects damaged checkpoints %s without regenerating IDs', (value) => {
    const state = fixture();
    applyUsersImport(state.store, state.options);
    state.meta(USERS_IMPORT_KEY)[1] = value;
    const writes = state.count();
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_CHECKPOINT_INVALID');
    expect(state.count()).toBe(writes);
  });
  it('does not overwrite another data revision', () => {
    const state = fixture();
    applyUsersImport(state.store, state.options);
    state.meta('data_revision')[1] = '5';
    const count = state.count();
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_REVISION_CONFLICT');
    expect(state.count()).toBe(count);
  });
  it('rejects formula-like source cells and duplicate generated IDs before the checkpoint', () => {
    const state = fixture();
    state.options.bindings[0] = { email: 'owner@example.test', sub: '=FORMULA()', joinedAt };
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_UNSAFE_VALUE');
    const id = randomUUID();
    expect(() => applyUsersImport(state.store, { ...state.options, uuid: () => id })).toThrow(
      'IMPORT_CONFIG_INVALID',
    );
    expect(state.count()).toBe(0);
  });
  it('stops for missing schema, maintenance mode and malformed revisions', () => {
    const state = fixture();
    state.meta('schema_version')[1] = '0';
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_SCHEMA_REQUIRED');
    state.meta('schema_version')[1] = '1';
    state.meta('maintenance_mode')[1] = 'true';
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_SCHEMA_REQUIRED');
    state.meta('maintenance_mode')[1] = 'false';
    state.meta('data_revision')[1] = '1.5';
    expect(() => applyUsersImport(state.store, state.options)).toThrow('IMPORT_META_INVALID');
    expect(state.count()).toBe(0);
  });
});
