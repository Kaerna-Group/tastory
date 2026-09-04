const WINDOW_SECONDS = 60;
const WINDOW_CACHE_SECONDS = 120;

const LIMITS = {
  signIn: { deployment: 60, credential: 6 },
  protected: { deployment: 300, credential: 120 },
} as const;

function digestCredential(credential: string): string {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    credential,
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function count(cache: GoogleAppsScript.Cache.Cache, key: string): number {
  const raw = cache.get(key);
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

/**
 * Best-effort admission control before signature verification and storage access.
 * The token itself is never cached; only its SHA-256 digest is used as a bucket key.
 */
export function admitProductionRequest(action: string, credential: string): boolean {
  if (PropertiesService.getScriptProperties().getProperty('APP_ENV') !== 'production') return true;
  const kind = action === 'auth.signIn' ? 'signIn' : 'protected';
  const limits = LIMITS[kind];
  const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const prefix = `request-limit-v1:${kind}:${window}:`;
  const deploymentKey = prefix + 'deployment';
  const credentialKey = prefix + digestCredential(credential);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(250)) return false;
  try {
    const cache = CacheService.getScriptCache();
    const deploymentCount = count(cache, deploymentKey);
    const credentialCount = count(cache, credentialKey);
    if (deploymentCount >= limits.deployment || credentialCount >= limits.credential) return false;
    cache.put(deploymentKey, String(deploymentCount + 1), WINDOW_CACHE_SECONDS);
    cache.put(credentialKey, String(credentialCount + 1), WINDOW_CACHE_SECONDS);
    return true;
  } catch {
    return false;
  } finally {
    lock.releaseLock();
  }
}
