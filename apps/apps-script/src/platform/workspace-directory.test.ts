import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateGoogle } from './google-auth';
import { CORE_TABLES } from '../schema/core-schema';
import { handleRequest } from '../controllers/handle-request';
import type * as TokenModule from '../auth/google-token';

const verifier = vi.hoisted(() => vi.fn());
vi.mock('../auth/google-token', async (original) => ({
  ...(await original<typeof TokenModule>()),
  verifyGoogleToken: verifier,
}));
const ownerId = '11111111-1111-4111-8111-111111111111',
  viewerId = '22222222-2222-4222-8222-222222222222',
  bookId = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-09-03T11:00:00Z';
const getProperty = vi.fn(),
  setProperty = vi.fn(),
  releaseLock = vi.fn(),
  tryLock = vi.fn(),
  openById = vi.fn();
let properties: Record<string, string>,
  sheets: Map<string, unknown[][]>,
  formulas: string[][],
  overLimit: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  formulas = [];
  overLimit = false;
  properties = {
    APP_ENV: 'staging',
    GOOGLE_CLIENT_IDS: 'client.apps.googleusercontent.com',
    SPREADSHEET_ID: 'private-sheet',
    SHEETS_AUTH_CONFIG: JSON.stringify({ version: 1, backend: 'sheets', workspaceId: bookId }),
    STAGING_INVITES: JSON.stringify([
      { email: 'viewer@example.test', role: 'owner', expiresAt: '2050-01-01T00:00:00Z' },
    ]),
  };
  getProperty.mockImplementation((key: string) => properties[key] ?? null);
  sheets = new Map(CORE_TABLES.map(({ name, columns }) => [name, [[...columns]]]));
  sheets.get('Meta')?.push(
    ['schema_version', '1', timestamp],
    ['maintenance_mode', 'false', timestamp],
    ['data_revision', '1', timestamp],
    [
      'users_import_v1',
      JSON.stringify({
        version: 1,
        state: 'applied',
        sourceHash: 'a'.repeat(64),
        createdAt: timestamp,
        baseRevision: 0,
        ids: [ownerId, viewerId, bookId],
      }),
      timestamp,
    ],
  );
  sheets
    .get('Users')
    ?.push(
      [
        ownerId,
        'owner-sub',
        'owner@example.test',
        'owner@example.test',
        '',
        '',
        'active',
        new Date(timestamp),
        '',
        1,
      ],
      [
        viewerId,
        'viewer-sub',
        'viewer@example.test',
        'viewer@example.test',
        '',
        '',
        'active',
        timestamp,
        '',
        '1',
      ],
    );
  sheets.get('Workspaces')?.push([bookId, 'Book', ownerId, '', '', timestamp, timestamp, '1']);
  sheets
    .get('WorkspaceMembers')
    ?.push(
      [bookId, ownerId, 'owner', 'active', timestamp, '1'],
      [bookId, viewerId, 'viewer', 'active', timestamp, '1'],
    );
  openById.mockImplementation(() => ({
    getSheetByName: (name: string) => {
      const rows = sheets.get(name);
      if (!rows) return null;
      return {
        getLastRow: () => (overLimit ? 2000 : rows.length),
        getLastColumn: () => rows[0]?.length ?? 0,
        getRange: () => ({ getValues: () => rows, getFormulas: () => formulas }),
      };
    },
  }));
  tryLock.mockReturnValue(true);
  verifier.mockReturnValue({
    sub: 'viewer-sub',
    email: 'viewer@example.test',
    name: 'Viewer',
    emailAuthoritative: true,
    expiresAt: '2050-01-01T00:00:00Z',
  });
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty, setProperty }) });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock, releaseLock }) });
  vi.stubGlobal('SpreadsheetApp', { openById });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function row(table: string, index: number) {
  const value = sheets.get(table)?.[index];
  if (!value) throw new Error();
  return value;
}
describe('Sheets-backed Google authorization', () => {
  it('reads the stored role rather than an old invitation and preserves the existing wire identity', () => {
    expect(authenticateGoogle('credential', true)).toMatchObject({
      user: { id: 'viewer-sub', role: 'viewer' },
    });
    expect(getProperty.mock.calls.flat()).not.toContain('STAGING_INVITES');
    expect(getProperty.mock.calls.flat()).not.toContain('STAGING_AUTH_BINDINGS');
    expect(setProperty).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it('uses a production-only audience and never falls back to staging invitations', () => {
    properties.APP_ENV = 'production';
    properties.PRODUCTION_GOOGLE_CLIENT_IDS = 'production.apps.googleusercontent.com';
    delete properties.GOOGLE_CLIENT_IDS;
    expect(authenticateGoogle('credential', false).user.role).toBe('viewer');
    expect(verifier.mock.calls.at(-1)?.[1]).toMatchObject({
      audiences: ['production.apps.googleusercontent.com'],
    });
    delete properties.SHEETS_AUTH_CONFIG;
    properties.STAGING_INVITES = JSON.stringify([
      { email: 'viewer@example.test', role: 'viewer', expiresAt: '2050-01-01T00:00:00Z' },
    ]);
    expect(() => authenticateGoogle('credential', true)).toThrow('AUTH_NOT_CONFIGURED');
    expect(getProperty.mock.calls.flat()).not.toContain('STAGING_AUTH_BINDINGS');
  });
  it('rereads revocation and role changes on the next request without cached membership', () => {
    expect(authenticateGoogle('credential', false).user.role).toBe('viewer');
    row('WorkspaceMembers', 2)[2] = 'member';
    expect(authenticateGoogle('credential', false).user.role).toBe('member');
    row('WorkspaceMembers', 2)[3] = 'disabled';
    expect(() => authenticateGoogle('credential', false)).toThrow('ACCESS_DENIED');
    row('WorkspaceMembers', 2)[3] = 'active';
    row('Users', 2)[6] = 'disabled';
    expect(() => authenticateGoogle('credential', false)).toThrow('ACCESS_DENIED');
    expect(setProperty).not.toHaveBeenCalled();
  });
  it('does not claim an unimported identity or rebind an account by matching email', () => {
    verifier.mockReturnValue({
      sub: 'another-sub',
      email: 'owner@example.test',
      name: 'Other',
      emailAuthoritative: true,
      expiresAt: '2050-01-01T00:00:00Z',
    });
    expect(() => authenticateGoogle('credential', true)).toThrow('ACCESS_DENIED');
    expect(setProperty).not.toHaveBeenCalled();
  });
  it.each(['', '{}', 'not-json', 'null'])(
    'never falls back to old invitations on invalid configuration %s',
    (config) => {
      properties.SHEETS_AUTH_CONFIG = config;
      expect(() => authenticateGoogle('credential', true)).toThrow('AUTH_UNAVAILABLE');
      expect(getProperty.mock.calls.flat()).not.toContain('STAGING_INVITES');
    },
  );
  it('fails closed on unavailable storage without leaking provider errors', () => {
    openById.mockImplementation(() => {
      throw new Error('private-sheet-provider-error');
    });
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(getProperty.mock.calls.flat()).not.toContain('STAGING_INVITES');
  });
  it('rejects changed headers, missing tables, formulas and oversized reads', () => {
    row('Users', 0)[0] = 'renamed';
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    row('Users', 0)[0] = 'user_id';
    formulas = [['=SECRET()']];
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    formulas = [];
    overLimit = true;
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    overLimit = false;
    sheets.delete('Users');
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
  });
  it('refuses maintenance mode, incomplete imports and invalid metadata', () => {
    row('Meta', 2)[1] = 'true';
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    row('Meta', 2)[1] = 'false';
    row('Meta', 4)[1] = '{}';
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    row('Meta', 3)[1] = '-1';
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
  });
  it('denies owner-only HTTP operations for the viewer selected from Sheets', () => {
    const operation = vi.fn();
    const requestId = '55555555-5555-4555-8555-555555555555';
    const response = handleRequest(
      {
        apiVersion: 1,
        requestId,
        action: 'spike.concurrency.read',
        credential: 'credential',
        payload: { runId: requestId },
      },
      {
        now: () => new Date(),
        createRequestId: () => requestId,
        isEchoEnabled: false,
        deploymentVersion: 'test',
        authenticate: authenticateGoogle,
        concurrency: operation,
      },
    );
    expect(response).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
    expect(operation).not.toHaveBeenCalled();
  });
  it('rejects an expired identity or busy lock before storage reads', () => {
    verifier.mockReturnValue({
      sub: 'viewer-sub',
      email: 'viewer@example.test',
      name: 'Viewer',
      expiresAt: '2000-01-01T00:00:00Z',
    });
    expect(() => authenticateGoogle('credential', false)).toThrow('UNAUTHENTICATED');
    expect(openById).not.toHaveBeenCalled();
    tryLock.mockReturnValue(false);
    expect(() => authenticateGoogle('credential', false)).toThrow('AUTH_UNAVAILABLE');
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
