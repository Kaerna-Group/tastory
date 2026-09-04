import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminHealthDataSchema, adminUsersDataSchema } from '@tastory/contracts';
import type { AdminAction, AuthData } from '@tastory/contracts';
import { readAdminDirectory } from './admin-directory';
import {
  CORE_TABLES,
  CORE_MIGRATION_ID,
  CORE_MIGRATION_NAME,
  CORE_SCHEMA_FINGERPRINT,
} from '../schema/core-schema';
import { handleRequest } from '../controllers/handle-request';

const ownerId = '11111111-1111-4111-8111-111111111111';
const viewerId = '22222222-2222-4222-8222-222222222222';
const bookId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const otherBook = '55555555-5555-4555-8555-555555555555';
const timestamp = '2026-09-03T12:00:00.000Z';
const session = (): AuthData => ({
  user: { id: 'owner-sub', email: 'ignored@example.test', name: 'Owner', role: 'owner' },
  expiresAt: '2026-09-03T13:00:00.000Z',
});
const checksum = createHash('sha256').update(CORE_SCHEMA_FINGERPRINT).digest('hex');
let properties: Record<string, string>, sheets: Map<string, unknown[][]>;
const tryLock = vi.fn(),
  releaseLock = vi.fn(),
  openById = vi.fn(),
  getProperty = vi.fn();
let held: boolean;
function row(table: string, index: number) {
  const result = sheets.get(table)?.[index];
  if (!result) throw new Error('Fixture row missing');
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
  held = false;
  properties = {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'private-sheet',
    DRIVE_FOLDER_ID: 'private-folder',
    SHEETS_AUTH_CONFIG: JSON.stringify({ version: 1, backend: 'sheets', workspaceId: bookId }),
  };
  sheets = new Map(CORE_TABLES.map(({ name, columns }) => [name, [[...columns]]]));
  const meta = {
    schema_version: '1',
    api_version: '1',
    data_revision: '1',
    created_at: timestamp,
    drive_root_folder_id: 'private-folder',
    maintenance_mode: 'false',
    users_import_v1: JSON.stringify({
      version: 1,
      state: 'applied',
      sourceHash: 'a'.repeat(64),
      createdAt: timestamp,
      baseRevision: 0,
      ids: [ownerId, viewerId, bookId],
    }),
  };
  sheets.get('Meta')?.push(...Object.entries(meta).map(([key, value]) => [key, value, timestamp]));
  sheets
    .get('SchemaMigrations')
    ?.push([
      CORE_MIGRATION_ID,
      CORE_MIGRATION_NAME,
      checksum,
      timestamp,
      'system:setupStagingSchema',
      'applied',
    ]);
  for (const [id, subject, email] of [
    [ownerId, 'owner-sub', 'owner@example.test'],
    [viewerId, 'viewer-sub', 'viewer@example.test'],
    [otherId, 'other-sub', 'private-other@example.test'],
  ]) {
    sheets.get('Users')?.push([id, subject, email, email, '', '', 'active', timestamp, '', '1']);
  }
  sheets
    .get('Workspaces')
    ?.push(
      [bookId, 'Книга', ownerId, '', '', timestamp, timestamp, '1'],
      [otherBook, 'Чужая книга', otherId, '', '', timestamp, timestamp, '1'],
    );
  sheets
    .get('WorkspaceMembers')
    ?.push(
      [bookId, ownerId, 'owner', 'active', timestamp, '1'],
      [bookId, viewerId, 'viewer', 'active', timestamp, '1'],
      [otherBook, otherId, 'owner', 'active', timestamp, '1'],
    );
  getProperty.mockImplementation((key: string) => properties[key] ?? null);
  tryLock.mockImplementation(() => {
    held = true;
    return true;
  });
  releaseLock.mockImplementation(() => {
    held = false;
  });
  openById.mockImplementation(() => {
    expect(held).toBe(true);
    return {
      getSheetByName: (name: string) => {
        const rows = sheets.get(name);
        if (!rows) return null;
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => rows[0]?.length ?? 0,
          getRange: (start: number, _column: number, height: number) => ({
            getValues: () => rows.slice(start - 1, start - 1 + height),
            getFormulas: () => [],
          }),
        };
      },
    };
  });
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty }) });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock, releaseLock }) });
  vi.stubGlobal('SpreadsheetApp', { openById });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'sha' },
    Charset: { UTF_8: 'utf' },
    computeDigest: () => Array.from(Buffer.from(checksum, 'hex')),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('read-only workspace administration', () => {
  it('lists only the selected workspace using UUIDs without Google subjects or other users', () => {
    const before = JSON.stringify([...sheets]);
    const data = adminUsersDataSchema.parse(readAdminDirectory('admin.users.list', session()));
    expect(data.users.map((user) => [user.id, user.role])).toEqual([
      [ownerId, 'owner'],
      [viewerId, 'viewer'],
    ]);
    expect(JSON.stringify(data)).not.toMatch(
      /owner-sub|viewer-sub|other-sub|private-|email_normalized|google_sub/,
    );
    expect(JSON.stringify([...sheets])).toBe(before);
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it('checks the applied migration and counts only this workspace, excluding disabled access', () => {
    row('WorkspaceMembers', 2)[3] = 'disabled';
    const data = adminHealthDataSchema.parse(readAdminDirectory('admin.health', session()));
    expect(data).toMatchObject({
      schemaVersion: 1,
      tablesChecked: 6,
      members: 2,
      activeMembers: 1,
    });
    expect(getProperty.mock.calls.flat()).not.toContain('STAGING_INVITES');
  });
  it('keeps disabled and pending member statuses visible to the owner', () => {
    row('Users', 2)[6] = 'pending';
    row('WorkspaceMembers', 2)[3] = 'disabled';
    expect(
      adminUsersDataSchema.parse(readAdminDirectory('admin.users.list', session())).users[1],
    ).toMatchObject({ userStatus: 'pending', membershipStatus: 'disabled' });
  });
  it.each(['viewer', 'member'] as const)(
    'denies %s even when an earlier session says owner',
    (role) => {
      row('WorkspaceMembers', 2)[2] = role;
      const forged = session();
      forged.user.id = 'viewer-sub';
      expect(() => readAdminDirectory('admin.users.list', forged)).toThrow('ACCESS_DENIED');
      expect(releaseLock).toHaveBeenCalledOnce();
    },
  );
  it('denies a user who owns a different workspace', () => {
    const other = session();
    other.user.id = 'other-sub';
    expect(() => readAdminDirectory('admin.health', other)).toThrow('ACCESS_DENIED');
  });
  it('rechecks disabled ownership and subject binding instead of trusting session email', () => {
    row('WorkspaceMembers', 1)[3] = 'disabled';
    expect(() => readAdminDirectory('admin.users.list', session())).toThrow('ACCESS_DENIED');
    row('WorkspaceMembers', 1)[3] = 'active';
    const other = session();
    other.user.id = 'unknown';
    other.user.email = 'owner@example.test';
    expect(() => readAdminDirectory('admin.users.list', other)).toThrow('ACCESS_DENIED');
  });
  it.each(['admin.health', 'admin.users.list'] as const)(
    'protects the HTTP %s action and rejects client workspace/role fields',
    (action: AdminAction) => {
      const admin = vi.fn(readAdminDirectory);
      const context = {
        now: () => new Date(),
        createRequestId: () => ownerId,
        isEchoEnabled: false,
        deploymentVersion: 'test',
        authenticate: () => session(),
        admin,
      };
      const request = {
        apiVersion: 1,
        requestId: ownerId,
        action,
        credential: 'verified-elsewhere',
        payload: {},
      };
      expect(handleRequest(request, context)).toMatchObject({ ok: true, requestId: ownerId });
      admin.mockClear();
      expect(
        handleRequest(request, {
          ...context,
          authenticate: () => ({ ...session(), user: { ...session().user, role: 'viewer' } }),
        }),
      ).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
      expect(
        handleRequest({ ...request, payload: { workspaceId: otherBook, role: 'owner' } }, context),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(handleRequest({ ...request, credential: undefined }, context)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
      expect(admin).not.toHaveBeenCalled();
      expect(
        handleRequest(request, {
          now: context.now,
          createRequestId: context.createRequestId,
          isEchoEnabled: false,
          deploymentVersion: 'test',
          authenticate: context.authenticate,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'ADMIN_UNAVAILABLE' },
      });
    },
  );
  it.each(['', '{}', 'null', 'broken-json'])(
    'does not fall back when the Sheets config is %s',
    (value) => {
      properties.SHEETS_AUTH_CONFIG = value;
      expect(() => readAdminDirectory('admin.health', session())).toThrow('ADMIN_UNAVAILABLE');
      expect(openById).not.toHaveBeenCalled();
    },
  );
  it('supports production and requires a configured spreadsheet', () => {
    properties.APP_ENV = 'production';
    expect(readAdminDirectory('admin.health', session())).toMatchObject({ status: 'ok' });
    openById.mockClear();
    properties.SPREADSHEET_ID = '';
    expect(() => readAdminDirectory('admin.health', session())).toThrow('ADMIN_UNAVAILABLE');
    expect(openById).not.toHaveBeenCalled();
  });
  it('denies expired credentials after lock contention or after a slow read', () => {
    const expired = { ...session(), expiresAt: timestamp };
    expect(() => readAdminDirectory('admin.health', expired)).toThrow('UNAUTHENTICATED');
    expect(openById).not.toHaveBeenCalled();
    const original = openById.getMockImplementation();
    openById.mockImplementation(() => {
      const result: unknown = original?.();
      vi.setSystemTime(new Date('2026-09-03T14:00:00Z'));
      return result;
    });
    expect(() => readAdminDirectory('admin.users.list', session())).toThrow('UNAUTHENTICATED');
  });
  it('does not release a lock it failed to acquire', () => {
    tryLock.mockReturnValue(false);
    expect(() => readAdminDirectory('admin.health', session())).toThrow('ADMIN_UNAVAILABLE');
    expect(openById).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
  });
  it('rejects damaged migration checksums, missing tables and maintenance mode', () => {
    row('SchemaMigrations', 1)[2] = 'b'.repeat(64);
    expect(() => readAdminDirectory('admin.health', session())).toThrow('ADMIN_UNAVAILABLE');
    row('SchemaMigrations', 1)[2] = checksum;
    sheets.delete('Invites');
    expect(() => readAdminDirectory('admin.health', session())).toThrow('ADMIN_UNAVAILABLE');
    row('Meta', 6)[1] = 'true';
    expect(() => readAdminDirectory('admin.users.list', session())).toThrow('AUTH_UNAVAILABLE');
  });
  it('redacts service failures', () => {
    openById.mockImplementation(() => {
      throw new Error('private-provider-secret');
    });
    expect(() => readAdminDirectory('admin.health', session())).toThrow('ADMIN_UNAVAILABLE');
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
