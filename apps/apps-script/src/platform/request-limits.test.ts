import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admitProductionRequest } from './request-limits';

let environment = 'production';
let lockAvailable = true;
let cacheBroken = false;
let cache: Map<string, string>;
const releaseLock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  cache = new Map();
  environment = 'production';
  lockAvailable = true;
  cacheBroken = false;
  vi.useFakeTimers();
  vi.setSystemTime('2026-09-03T12:00:30Z');
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (key: string) => (key === 'APP_ENV' ? environment : null),
    }),
  });
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_algorithm: string, credential: string) =>
      Array.from(credential, (character) => character.charCodeAt(0)),
    base64EncodeWebSafe: (digest: number[]) => digest.join('-'),
  });
  vi.stubGlobal('LockService', {
    getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock }),
  });
  vi.stubGlobal('CacheService', {
    getScriptCache: () => {
      if (cacheBroken) throw new Error('cache');
      return {
        get: (key: string) => cache.get(key) ?? null,
        put: (key: string, value: string) => cache.set(key, value),
      };
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('production request admission', () => {
  it('limits repeated sign-in attempts without storing credentials', () => {
    for (let index = 0; index < 6; index += 1)
      expect(admitProductionRequest('auth.signIn', 'private-token')).toBe(true);
    expect(admitProductionRequest('auth.signIn', 'private-token')).toBe(false);
    expect([...cache.keys()].join(' ')).not.toContain('private-token');
    expect(releaseLock).toHaveBeenCalledTimes(7);
  });

  it('keeps a separate, larger bucket for an authenticated client', () => {
    for (let index = 0; index < 120; index += 1)
      expect(admitProductionRequest('recipes.list', 'credential')).toBe(true);
    expect(admitProductionRequest('recipes.list', 'credential')).toBe(false);
  });

  it('limits deployment-wide sign-in attempts across changing credentials', () => {
    for (let index = 0; index < 60; index += 1)
      expect(admitProductionRequest('auth.signIn', `credential-${index}`)).toBe(true);
    expect(admitProductionRequest('auth.signIn', 'credential-over-limit')).toBe(false);
  });

  it('fails closed in production and stays disabled in staging', () => {
    lockAvailable = false;
    expect(admitProductionRequest('auth.signIn', 'credential')).toBe(false);
    lockAvailable = true;
    cacheBroken = true;
    expect(admitProductionRequest('auth.signIn', 'credential')).toBe(false);
    environment = 'staging';
    expect(admitProductionRequest('auth.signIn', 'credential')).toBe(true);
  });
});
