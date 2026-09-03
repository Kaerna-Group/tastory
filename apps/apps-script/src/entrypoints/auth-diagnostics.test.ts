import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseStagingAuth } from './auth-diagnostics';

const certs = JSON.stringify({
  keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'test-key', n: 'abc', e: 'AQAB' }],
});
let properties: Record<string, string>;
let cached: Record<string, string>;
const setProperty = vi.fn();
const put = vi.fn();
const release = vi.fn();
const tryLock = vi.fn();
const fetchKeys = vi.fn();
const log = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  properties = {
    APP_ENV: 'staging',
    GOOGLE_CLIENT_IDS: 'private-client.apps.googleusercontent.com',
    STAGING_INVITES: JSON.stringify([
      { email: 'private@example.test', role: 'owner', expiresAt: '2026-09-10T12:00:00Z' },
    ]),
    STAGING_AUTH_BINDINGS: JSON.stringify([
      { email: 'private@example.test', sub: 'private-google-id', joinedAt: '2026-09-03T09:00:00Z' },
    ]),
  };
  cached = { 'google-jwks-v1': certs };
  tryLock.mockReturnValue(true);
  fetchKeys.mockReturnValue({ getResponseCode: () => 200, getContentText: () => certs });
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (name: string) => properties[name] ?? null,
      setProperty,
    }),
  });
  vi.stubGlobal('CacheService', {
    getScriptCache: () => ({ get: (name: string) => cached[name] ?? null, put }),
  });
  vi.stubGlobal('UrlFetchApp', { fetch: fetchKeys });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock, releaseLock: release }) });
  vi.spyOn(console, 'info').mockImplementation(log);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editor-only auth diagnostics', () => {
  it('reports health without exposing or changing identities, properties or cache', () => {
    const before = JSON.stringify(properties);
    const result = diagnoseStagingAuth();
    expect(result).toMatchObject({
      environment: 'staging',
      clientIds: 'valid',
      invitations: { status: 'valid', count: 1 },
      bindings: { status: 'valid', count: 1 },
      keyCache: { status: 'valid', count: 1 },
      googleKeys: { status: 'valid', count: 1 },
      scriptLock: 'available',
      keyRefreshMarker: 'absent',
    });
    expect(JSON.stringify(result)).not.toMatch(/private|test-key|example\.test/);
    expect(log).toHaveBeenCalledWith(JSON.stringify(result));
    expect(JSON.stringify(properties)).toBe(before);
    expect(setProperty).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
  it('pinpoints malformed invitations and invalid binding fields without reflecting values', () => {
    properties.STAGING_INVITES = '{private';
    properties.STAGING_AUTH_BINDINGS = JSON.stringify([
      { email: 'private-secret', 'private-extra': 'private-value' },
    ]);
    const result = diagnoseStagingAuth();
    expect(result.invitations.status).toBe('invalid-json');
    expect(result.bindings).toMatchObject({
      status: 'invalid-schema',
      fields: ['0.email', '0.sub', '0.joinedAt', '0'],
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('reports missing configuration and cache without writing defaults', () => {
    properties = {};
    cached = {};
    expect(diagnoseStagingAuth()).toMatchObject({
      environment: 'missing',
      clientIds: 'missing',
      invitations: { status: 'missing' },
      bindings: { status: 'missing' },
      keyCache: { status: 'missing' },
    });
    expect(setProperty).not.toHaveBeenCalled();
  });
  it('identifies invalid root JSON schema, key cache and provider errors with a busy lock', () => {
    properties.APP_ENV = 'production';
    properties.GOOGLE_CLIENT_IDS = 'bad';
    properties.STAGING_INVITES = '{}';
    cached = { 'google-jwks-v1': 'invalid', 'google-jwks-refreshed-v1': '1' };
    fetchKeys.mockReturnValue({
      getResponseCode: () => 503,
      getContentText: () => 'private-server-message',
    });
    tryLock.mockReturnValue(false);
    expect(diagnoseStagingAuth()).toMatchObject({
      environment: 'other',
      clientIds: 'invalid',
      invitations: { status: 'invalid-schema', fields: ['$'] },
      keyCache: { status: 'invalid-json' },
      keyRefreshMarker: 'present',
      googleKeys: { status: 'http-error', httpStatus: 503 },
      scriptLock: 'busy',
    });
    expect(release).not.toHaveBeenCalled();
  });
  it('redacts service exceptions and continues checking other services', () => {
    vi.stubGlobal('PropertiesService', {
      getScriptProperties: () => {
        throw new Error('private-property-error');
      },
    });
    vi.stubGlobal('CacheService', {
      getScriptCache: () => {
        throw new Error('private-cache-error');
      },
    });
    fetchKeys.mockImplementation(() => {
      throw new Error('private-fetch-error');
    });
    tryLock.mockImplementation(() => {
      throw new Error('private-lock-error');
    });
    const result = diagnoseStagingAuth();
    expect(result).toMatchObject({
      environment: 'unavailable',
      clientIds: 'unavailable',
      invitations: { status: 'unavailable' },
      bindings: { status: 'unavailable' },
      keyCache: { status: 'unavailable' },
      keyRefreshMarker: 'unavailable',
      googleKeys: { status: 'unavailable' },
      scriptLock: 'unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each(['x'.repeat(20_001), JSON.stringify({ keys: [{ privateField: 'private-value' }] })])(
    'bounds and redacts unexpected Google key responses',
    (body) => {
      fetchKeys.mockReturnValue({ getResponseCode: () => 200, getContentText: () => body });
      const result = diagnoseStagingAuth();
      expect(result.googleKeys.status).toBe('invalid-schema');
      expect(JSON.stringify(result)).not.toContain('private');
    },
  );
});
