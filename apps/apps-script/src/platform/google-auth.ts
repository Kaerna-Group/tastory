import { AuthError, googleKeysSchema, verifyGoogleToken } from '../auth/google-token';
import { admitIdentity, bindingsSchema, invitationsSchema } from '../auth/invitations';
import type { GoogleKey } from '../auth/google-token';
import { authenticateSheets, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { runtimeEnvironment } from './runtime-environment';

const keyCacheName = 'google-jwks-v1';
const refreshCacheName = 'google-jwks-refreshed-v1';

function getGoogleKey(kid: string): GoogleKey | undefined {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(keyCacheName);
  if (cached) {
    const keys = googleKeysSchema.parse(JSON.parse(cached)).keys;
    const key = keys.find((item) => item.kid === kid);
    if (key || cache.get(refreshCacheName)) return key;
  }
  // Unknown kids cannot trigger unbounded fetches. A failed refresh never uses stale keys.
  if (cache.get(refreshCacheName)) throw new AuthError('AUTH_UNAVAILABLE');
  const refreshLock = LockService.getScriptLock();
  if (!refreshLock.tryLock(1000)) throw new AuthError('AUTH_UNAVAILABLE');
  try {
    // Another request may have refreshed the keys while this request waited.
    const refreshed = cache.get(keyCacheName);
    if (refreshed) {
      const key = googleKeysSchema
        .parse(JSON.parse(refreshed))
        .keys.find((item) => item.kid === kid);
      if (key || cache.get(refreshCacheName)) return key;
    }
    if (cache.get(refreshCacheName)) throw new AuthError('AUTH_UNAVAILABLE');
    cache.put(refreshCacheName, '1', 60);
    const response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs', {
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true,
    });
    if (response.getResponseCode() !== 200) throw new Error();
    const text = response.getContentText();
    if (text.length > 20_000) throw new Error();
    const parsed = googleKeysSchema.parse(JSON.parse(text));
    const headers = response.getHeaders();
    const control = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === 'cache-control',
    )?.[1];
    const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(String(control ?? ''))?.[1];
    const ttl = Math.min(Number(maxAge ?? 0), 21600);
    if (ttl > 0) cache.put(keyCacheName, JSON.stringify(parsed), ttl);
    return parsed.keys.find((key) => key.kid === kid);
  } catch {
    throw new AuthError('AUTH_UNAVAILABLE');
  } finally {
    refreshLock.releaseLock();
  }
}

export function authenticateGoogle(credential: string, allowJoin: boolean) {
  const properties = PropertiesService.getScriptProperties();
  const environment = runtimeEnvironment(properties.getProperty('APP_ENV'));
  if (!environment) throw new AuthError('AUTH_NOT_CONFIGURED');
  const audienceKey =
    environment === 'production' ? 'PRODUCTION_GOOGLE_CLIENT_IDS' : 'GOOGLE_CLIENT_IDS';
  const audiences = (properties.getProperty(audienceKey) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (
    !audiences.length ||
    audiences.length > 5 ||
    new Set(audiences).size !== audiences.length ||
    audiences.some((id) => !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id))
  )
    throw new AuthError('AUTH_NOT_CONFIGURED');
  if (environment === 'production' && properties.getProperty(SHEETS_AUTH_CONFIG_KEY) === null)
    throw new AuthError('AUTH_NOT_CONFIGURED');
  const identity = verifyGoogleToken(credential, {
    audiences,
    now: () => new Date(),
    getKey: getGoogleKey,
    decodeBase64: (part) =>
      Uint8Array.from(Utilities.base64DecodeWebSafe(part), (byte) => byte & 255),
    decodeJson: (part) =>
      JSON.parse(
        Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString('UTF-8'),
      ) as unknown,
  });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new AuthError('AUTH_UNAVAILABLE');
  try {
    // Read the switch under the same lock as activation and authorization. A configured but
    // unavailable Sheets backend never falls back to the old invitation registry.
    if (Date.parse(identity.expiresAt) <= Date.now()) throw new AuthError('UNAUTHENTICATED');
    const sheetsConfig = properties.getProperty(SHEETS_AUTH_CONFIG_KEY);
    if (sheetsConfig !== null)
      return authenticateSheets(
        identity,
        sheetsConfig,
        properties.getProperty('SPREADSHEET_ID'),
        allowJoin,
      );
    if (environment === 'production') throw new AuthError('AUTH_NOT_CONFIGURED');
    const rawInvites = properties.getProperty('STAGING_INVITES');
    if (!rawInvites) throw new AuthError('AUTH_NOT_CONFIGURED');
    const invitations = invitationsSchema.parse(JSON.parse(rawInvites));
    const bindings = bindingsSchema.parse(
      JSON.parse(properties.getProperty('STAGING_AUTH_BINDINGS') ?? '[]'),
    );
    const count = bindings.length;
    // Recheck expiry after lock contention; no expired token may claim an invitation.
    if (Date.parse(identity.expiresAt) <= Date.now()) throw new AuthError('UNAUTHENTICATED');
    const session = admitIdentity(identity, invitations, bindings, new Date(), allowJoin);
    if (bindings.length !== count)
      properties.setProperty('STAGING_AUTH_BINDINGS', JSON.stringify(bindings));
    return session;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('AUTH_UNAVAILABLE');
  } finally {
    lock.releaseLock();
  }
}
