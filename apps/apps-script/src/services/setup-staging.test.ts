import { describe, expect, it, vi } from 'vitest';
import { setupStagingResources } from './setup-staging';
import type { StagingSetupPlatform } from './setup-staging';

function createPlatform(initial: Record<string, string> = {}) {
  const properties = { ...initial };
  const spreadsheet = { id: 'sheet-test', url: 'https://example.test/sheet' };
  const folder = { id: 'folder-test', url: 'https://example.test/folder' };
  const platform = {
    readProperties: () => ({ ...properties }),
    saveProperty: vi.fn((key: string, value: string): void => {
      properties[key] = value;
    }),
    createSpreadsheet: vi.fn(() => spreadsheet),
    openSpreadsheet: vi.fn(() => spreadsheet),
    createAssetFolder: vi.fn(() => folder),
    openAssetFolder: vi.fn(() => folder),
  } satisfies StagingSetupPlatform;
  return { platform, properties };
}

describe('staging resource setup', () => {
  it('creates and records resources without initializing the application schema', () => {
    const { platform, properties } = createPlatform();
    expect(setupStagingResources(platform)).toEqual({
      environment: 'staging',
      spreadsheetUrl: 'https://example.test/sheet',
      assetFolderUrl: 'https://example.test/folder',
      created: { spreadsheet: true, assetFolder: true },
      schemaVersion: 0,
    });
    expect(properties).toMatchObject({
      APP_ENV: 'staging',
      SPREADSHEET_ID: 'sheet-test',
      DRIVE_FOLDER_ID: 'folder-test',
      ENABLE_SPIKE_ECHO: 'false',
    });
  });
  it('reuses recorded resources on the second run', () => {
    const { platform } = createPlatform();
    setupStagingResources(platform);
    expect(setupStagingResources(platform).created).toEqual({
      spreadsheet: false,
      assetFolder: false,
    });
    expect(platform.createSpreadsheet).toHaveBeenCalledTimes(1);
    expect(platform.createAssetFolder).toHaveBeenCalledTimes(1);
    expect(platform.openSpreadsheet).toHaveBeenCalledWith('sheet-test');
    expect(platform.openAssetFolder).toHaveBeenCalledWith('folder-test');
  });
  it('keeps the spreadsheet ID when folder creation fails and resumes on retry', () => {
    const { platform, properties } = createPlatform();
    platform.createAssetFolder.mockImplementationOnce(() => {
      throw new Error('Drive unavailable');
    });
    expect(() => setupStagingResources(platform)).toThrow('Drive unavailable');
    expect(properties['SPREADSHEET_ID']).toBe('sheet-test');
    expect(setupStagingResources(platform).created).toEqual({
      spreadsheet: false,
      assetFolder: true,
    });
    expect(platform.createSpreadsheet).toHaveBeenCalledTimes(1);
  });
  it.each([
    { APP_ENV: 'production' },
    { APP_ENV: 'invalid' },
    { SPREADSHEET_ID: 'existing' },
    { DRIVE_FOLDER_ID: 'existing' },
  ])('does not change an unsafe target', (initial) => {
    const { platform } = createPlatform(initial);
    expect(() => setupStagingResources(platform)).toThrow();
    expect(platform.saveProperty).not.toHaveBeenCalled();
    expect(platform.createSpreadsheet).not.toHaveBeenCalled();
    expect(platform.createAssetFolder).not.toHaveBeenCalled();
  });
  it('does not silently replace a missing or inaccessible resource', () => {
    const { platform } = createPlatform({ APP_ENV: 'staging', SPREADSHEET_ID: 'missing' });
    platform.openSpreadsheet.mockImplementationOnce(() => {
      throw new Error('Not found');
    });
    expect(() => setupStagingResources(platform)).toThrow('Not found');
    expect(platform.createSpreadsheet).not.toHaveBeenCalled();
  });
  it('preserves existing echo and deployment settings', () => {
    const { platform, properties } = createPlatform({
      APP_ENV: 'staging',
      ENABLE_SPIKE_ECHO: 'true',
      DEPLOYMENT_VERSION: 'spike-002',
    });
    setupStagingResources(platform);
    expect(properties['ENABLE_SPIKE_ECHO']).toBe('true');
    expect(properties['DEPLOYMENT_VERSION']).toBe('spike-002');
  });
});
