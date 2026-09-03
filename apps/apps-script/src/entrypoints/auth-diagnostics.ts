import { googleKeysSchema } from '../auth/google-token';
import { bindingsSchema, invitationsSchema } from '../auth/invitations';
import type { z } from 'zod';

function inspectArray(raw: string | null | undefined, schema: z.ZodType<readonly unknown[]>) {
  if (raw === undefined) return { status: 'unavailable' as const };
  if (raw === null) return { status: 'missing' as const };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'invalid-json' as const };
  }
  const result = schema.safeParse(value);
  if (result.success) return { status: 'valid' as const, count: result.data.length };
  const safeFields = new Set(['email', 'role', 'expiresAt', 'sub', 'joinedAt', 'keys']);
  const fields = result.error.issues.slice(0, 5).map(
    (issue) =>
      issue.path
        .slice(0, 4)
        .map((part) =>
          typeof part === 'number'
            ? String(part)
            : safeFields.has(String(part))
              ? String(part)
              : '?',
        )
        .join('.') || '$',
  );
  return { status: 'invalid-schema' as const, fields };
}

function safelyRead(read: () => string | null): string | null | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

// Editor-only, read-only diagnostics. Never export property values, identities or raw errors.
export function diagnoseStagingAuth() {
  const property = (name: string) =>
    safelyRead(() => PropertiesService.getScriptProperties().getProperty(name));
  const env = property('APP_ENV');
  const clients = property('GOOGLE_CLIENT_IDS');
  const ids = (clients ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const keySchema = googleKeysSchema.transform((value) => value.keys);
  const keyCache = safelyRead(() => CacheService.getScriptCache().get('google-jwks-v1'));
  const marker = safelyRead(() => CacheService.getScriptCache().get('google-jwks-refreshed-v1'));
  let googleKeys: ReturnType<typeof inspectArray> | { status: 'http-error'; httpStatus: number };
  try {
    const response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs', {
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true,
    });
    const status = response.getResponseCode();
    const body = response.getContentText();
    googleKeys =
      status !== 200
        ? { status: 'http-error', httpStatus: status }
        : body.length > 20_000
          ? { status: 'invalid-schema', fields: ['$'] }
          : inspectArray(body, keySchema);
  } catch {
    googleKeys = { status: 'unavailable' };
  }
  let scriptLock: 'available' | 'busy' | 'unavailable';
  try {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(1000)) {
      lock.releaseLock();
      scriptLock = 'available';
    } else scriptLock = 'busy';
  } catch {
    scriptLock = 'unavailable';
  }
  const report = {
    formatVersion: 1,
    checkedAt: new Date().toISOString(),
    environment:
      env === undefined
        ? 'unavailable'
        : env === null
          ? 'missing'
          : env === 'staging'
            ? 'staging'
            : 'other',
    clientIds:
      clients === undefined
        ? 'unavailable'
        : !ids.length
          ? 'missing'
          : ids.every((id) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(id))
            ? 'valid'
            : 'invalid',
    invitations: inspectArray(property('STAGING_INVITES'), invitationsSchema),
    bindings: inspectArray(property('STAGING_AUTH_BINDINGS'), bindingsSchema),
    keyCache: inspectArray(keyCache, keySchema),
    keyRefreshMarker: marker === undefined ? 'unavailable' : marker === null ? 'absent' : 'present',
    googleKeys,
    scriptLock,
  };
  console.info(JSON.stringify(report));
  return report;
}
