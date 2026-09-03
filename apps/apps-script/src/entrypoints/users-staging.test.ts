import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planStagingUsers, setupStagingUsers } from './users-staging';
import { SchemaMigrationError } from '../services/core-migration';
import type * as CoreMigration from '../services/core-migration';
import type * as UsersImport from '../services/users-import';

const mocks = vi.hoisted(() => ({
  schema: vi.fn(),
  plan: vi.fn(),
  apply: vi.fn(),
  store: vi.fn(),
}));
vi.mock('../services/core-migration', async (original) => ({
  ...(await original<typeof CoreMigration>()),
  planCoreSchema: mocks.schema,
}));
vi.mock('../services/users-import', async (original) => ({
  ...(await original<typeof UsersImport>()),
  planUsersImport: mocks.plan,
  applyUsersImport: mocks.apply,
}));
vi.mock('../platform/users-import-store', () => ({ createUsersImportStore: mocks.store }));
const properties: Record<string, string> = {};
const tryLock = vi.fn(),
  releaseLock = vi.fn(),
  getProperty = vi.fn((key: string) => properties[key] ?? null);
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(properties, {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'private-sheet',
    DRIVE_FOLDER_ID: 'private-folder',
    STAGING_INVITES: '[]',
    STAGING_AUTH_BINDINGS: '[]',
  });
  tryLock.mockReturnValue(true);
  mocks.schema.mockReturnValue({ alreadyApplied: true });
  mocks.plan.mockReturnValue({ users: 2 });
  mocks.apply.mockReturnValue({ users: 2, result: 'applied' });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock, releaseLock }) });
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty }) });
  vi.stubGlobal('Session', { getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) });
  vi.stubGlobal('SpreadsheetApp', { openById: () => ({}) });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'SHA' },
    Charset: { UTF_8: 'UTF-8' },
    computeDigest: () => Array.from({ length: 32 }, () => -1),
    getUuid: () => 'test-uuid',
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('owner-run users import', () => {
  it('checks core schema, delegates a read-only plan and emits only its safe report', () => {
    expect(planStagingUsers()).toEqual({ ok: true, mode: 'plan', users: 2 });
    expect(mocks.schema).toHaveBeenCalledOnce();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(mocks.plan.mock.calls[0]?.[1]).toMatchObject({
      ownerEmail: 'owner@example.test',
      invitations: [],
      bindings: [],
    });
  });
  it('delegates the actual import only when applying', () => {
    expect(setupStagingUsers()).toMatchObject({ ok: true, mode: 'apply', result: 'applied' });
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it('stops before storage access on a busy lock or non-staging environment', () => {
    tryLock.mockReturnValue(false);
    expect(setupStagingUsers()).toMatchObject({ ok: false, code: 'IMPORT_BUSY' });
    expect(getProperty).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
    tryLock.mockReturnValue(true);
    properties.APP_ENV = 'production';
    expect(setupStagingUsers()).toMatchObject({ ok: false, code: 'IMPORT_STAGING_REQUIRED' });
    expect(mocks.schema).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it('refuses missing resources, incomplete schema and malformed source JSON', () => {
    properties.SPREADSHEET_ID = '';
    expect(setupStagingUsers()).toMatchObject({ ok: false, code: 'IMPORT_SCHEMA_REQUIRED' });
    properties.SPREADSHEET_ID = 'private-sheet';
    mocks.schema.mockReturnValue({ alreadyApplied: false });
    expect(setupStagingUsers()).toMatchObject({ ok: false, code: 'IMPORT_SCHEMA_REQUIRED' });
    mocks.schema.mockReturnValue({ alreadyApplied: true });
    properties.STAGING_INVITES = '{private';
    expect(setupStagingUsers()).toMatchObject({ ok: false, code: 'IMPORT_SOURCE_INVALID' });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('redacts service failures but preserves safe schema error codes and table names', () => {
    mocks.schema.mockImplementation(() => {
      throw new Error('private-error');
    });
    expect(setupStagingUsers()).toEqual({ ok: false, mode: 'apply', code: 'IMPORT_UNAVAILABLE' });
    mocks.schema.mockImplementation(() => {
      throw new SchemaMigrationError('HEADER_CONFLICT', 'Users');
    });
    expect(setupStagingUsers()).toEqual({
      ok: false,
      mode: 'apply',
      code: 'HEADER_CONFLICT',
      table: 'Users',
    });
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });
});
