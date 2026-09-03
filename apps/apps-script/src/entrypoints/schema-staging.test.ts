import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planStagingSchema, setupStagingSchema } from './schema-staging';

const properties: Record<string, string> = {
  APP_ENV: 'staging',
  SPREADSHEET_ID: 'private-sheet',
  DRIVE_FOLDER_ID: 'private-drive',
};
const getProperty = vi.fn((key: string) => properties[key] ?? null);
const tryLock = vi.fn();
const releaseLock = vi.fn();
const insertSheet = vi.fn();
const getSheetByName = vi.fn();
const openById = vi.fn();
const log = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  properties.APP_ENV = 'staging';
  properties.SPREADSHEET_ID = 'private-sheet';
  properties.DRIVE_FOLDER_ID = 'private-drive';
  tryLock.mockReturnValue(true);
  getSheetByName.mockReturnValue(null);
  openById.mockReturnValue({ getSheetByName, insertSheet });
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty }) });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock, releaseLock }) });
  vi.stubGlobal('SpreadsheetApp', { openById });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'SHA-256' },
    Charset: { UTF_8: 'UTF-8' },
    computeDigest: () => Array.from({ length: 32 }, () => -1),
  });
  vi.spyOn(console, 'info').mockImplementation(log);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editor-only core schema setup', () => {
  it('returns a redacted read-only plan and leaves identity properties untouched', () => {
    const result = planStagingSchema();
    expect(result).toMatchObject({ ok: true, mode: 'plan', fromVersion: 0, toVersion: 1 });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(insertSheet).not.toHaveBeenCalled();
    expect(getProperty.mock.calls.flat()).toEqual(['APP_ENV', 'SPREADSHEET_ID', 'DRIVE_FOLDER_ID']);
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it.each(['production', ''])(
    'rejects non-staging environment %s before accessing Sheets',
    (value) => {
      properties.APP_ENV = value;
      expect(setupStagingSchema()).toEqual({ ok: false, mode: 'apply', code: 'STAGING_REQUIRED' });
      expect(openById).not.toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledOnce();
    },
  );
  it('requires existing resource configuration and never creates another spreadsheet', () => {
    delete properties.SPREADSHEET_ID;
    expect(setupStagingSchema()).toMatchObject({ ok: false, code: 'STORAGE_NOT_CONFIGURED' });
    expect(openById).not.toHaveBeenCalled();
  });
  it('rejects a concurrent setup without reading storage or releasing someone else’s lock', () => {
    tryLock.mockReturnValue(false);
    expect(setupStagingSchema()).toEqual({ ok: false, mode: 'apply', code: 'SCHEMA_BUSY' });
    expect(openById).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
  });
  it('redacts provider exceptions and releases the acquired lock', () => {
    openById.mockImplementation(() => {
      throw new Error('private-sheet access error');
    });
    const result = setupStagingSchema();
    expect(result).toEqual({ ok: false, mode: 'apply', code: 'SCHEMA_SERVICE_UNAVAILABLE' });
    expect(log).toHaveBeenCalledWith(JSON.stringify(result));
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
