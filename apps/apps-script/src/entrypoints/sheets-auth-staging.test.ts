import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateStagingSheetsAuth } from './sheets-auth-staging';
import type * as Directory from '../platform/workspace-directory';
import type * as Access from '../auth/workspace-access';
import type * as Import from '../services/users-import';
import type * as Schema from '../services/core-migration';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  resolve: vi.fn(),
  importPlan: vi.fn(),
  corePlan: vi.fn(),
}));
vi.mock('../platform/workspace-directory', async (original) => ({
  ...(await original<typeof Directory>()),
  readWorkspaceDirectory: mocks.read,
}));
vi.mock('../auth/workspace-access', async (original) => ({
  ...(await original<typeof Access>()),
  resolveWorkspaceAccess: mocks.resolve,
}));
vi.mock('../services/users-import', async (original) => ({
  ...(await original<typeof Import>()),
  planUsersImport: mocks.importPlan,
}));
vi.mock('../services/core-migration', async (original) => ({
  ...(await original<typeof Schema>()),
  planCoreSchema: mocks.corePlan,
}));
const bookId = '33333333-3333-4333-8333-333333333333';
const getProperty = vi.fn(),
  setProperty = vi.fn(),
  tryLock = vi.fn(),
  releaseLock = vi.fn();
let properties: Record<string, string>, ownerEmail: string;
beforeEach(() => {
  vi.resetAllMocks();
  ownerEmail = 'owner@example.test';
  properties = {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'private-sheet',
    DRIVE_FOLDER_ID: 'private-drive',
    STAGING_INVITES: JSON.stringify([
      { email: ownerEmail, role: 'owner', expiresAt: '2050-01-01T00:00:00Z' },
    ]),
    STAGING_AUTH_BINDINGS: JSON.stringify([
      { email: ownerEmail, sub: 'private-owner-sub', joinedAt: '2026-09-03T10:00:00Z' },
    ]),
  };
  getProperty.mockImplementation((key: string) => properties[key] ?? null);
  setProperty.mockImplementation((key: string, value: string) => {
    properties[key] = value;
  });
  tryLock.mockReturnValue(true);
  mocks.read.mockReturnValue({
    users: [{ google_sub: 'private-owner-sub', email_normalized: 'owner@example.test' }],
    workspaces: [{ workspace_id: bookId }],
    members: [{ workspace_id: bookId, status: 'active' }],
  });
  mocks.resolve.mockReturnValue({ role: 'owner' });
  mocks.importPlan.mockReturnValue({ alreadyApplied: true });
  mocks.corePlan.mockReturnValue({ alreadyApplied: true });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock, releaseLock }) });
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty, setProperty }) });
  vi.stubGlobal('SpreadsheetApp', { openById: () => ({}) });
  vi.stubGlobal('Session', { getEffectiveUser: () => ({ getEmail: () => ownerEmail }) });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'sha' },
    Charset: { UTF_8: 'utf' },
    computeDigest: () => Array.from({ length: 32 }, () => 1),
    getUuid: () => 'unused',
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('owner activation of Sheets authorization', () => {
  it('validates the completed import and atomically writes only the backend selection', () => {
    const before = { ...properties };
    expect(activateStagingSheetsAuth()).toEqual({
      ok: true,
      result: 'enabled',
      backend: 'sheets',
      users: 1,
      memberships: 1,
    });
    expect(mocks.corePlan).toHaveBeenCalledOnce();
    expect(mocks.importPlan).toHaveBeenCalledOnce();
    expect(setProperty).toHaveBeenCalledExactlyOnceWith(
      'SHEETS_AUTH_CONFIG',
      JSON.stringify({ version: 1, backend: 'sheets', workspaceId: bookId }),
    );
    expect(properties).toMatchObject(before);
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it('repeats without touching the old registry or replacing the configured workspace', () => {
    activateStagingSheetsAuth();
    vi.clearAllMocks();
    properties.STAGING_INVITES = '{old-registry-no-longer-authoritative';
    expect(activateStagingSheetsAuth()).toMatchObject({ ok: true, result: 'already-enabled' });
    expect(setProperty).not.toHaveBeenCalled();
    expect(mocks.importPlan).not.toHaveBeenCalled();
    expect(getProperty.mock.calls.flat()).not.toContain('STAGING_INVITES');
  });
  it('handles a lost response after the property was saved', () => {
    setProperty.mockImplementation((key: string, value: string) => {
      properties[key] = value;
      throw new Error('private-provider-error');
    });
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    expect(activateStagingSheetsAuth()).toMatchObject({ ok: true, result: 'already-enabled' });
    expect(setProperty).toHaveBeenCalledOnce();
  });
  it('rejects another editor account or a non-owner member', () => {
    ownerEmail = 'another@example.test';
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'ACCESS_DENIED' });
    ownerEmail = 'owner@example.test';
    mocks.resolve.mockReturnValue({ role: 'viewer' });
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'ACCESS_DENIED' });
    expect(setProperty).not.toHaveBeenCalled();
  });
  it('does not enable while a live unclaimed legacy invitation remains', () => {
    const invites = JSON.parse(properties.STAGING_INVITES ?? '[]') as unknown[];
    invites.push({ email: 'new@example.test', role: 'viewer', expiresAt: '2050-01-01T00:00:00Z' });
    properties.STAGING_INVITES = JSON.stringify(invites);
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'PENDING_INVITATIONS' });
    expect(setProperty).not.toHaveBeenCalled();
  });
  it('requires an exact completed schema and import', () => {
    mocks.corePlan.mockReturnValue({ alreadyApplied: false });
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    mocks.corePlan.mockReturnValue({ alreadyApplied: true });
    mocks.importPlan.mockReturnValue({ alreadyApplied: false });
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    expect(setProperty).not.toHaveBeenCalled();
  });
  it('rejects a busy lock, wrong environment and missing resources before reading data', () => {
    tryLock.mockReturnValue(false);
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    expect(releaseLock).not.toHaveBeenCalled();
    tryLock.mockReturnValue(true);
    properties.APP_ENV = 'production';
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_NOT_CONFIGURED' });
    properties.APP_ENV = 'staging';
    properties.SPREADSHEET_ID = '';
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_NOT_CONFIGURED' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
  });
  it('redacts storage failures and does not overwrite a malformed existing selection', () => {
    mocks.read.mockImplementationOnce(() => {
      throw new Error('private-sheet-error');
    });
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    properties.SHEETS_AUTH_CONFIG = '{}';
    expect(activateStagingSheetsAuth()).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    expect(setProperty).not.toHaveBeenCalled();
  });
});
