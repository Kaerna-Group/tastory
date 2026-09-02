import { generateKeyPairSync, sign } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

export function checkAuthRuntime(code) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const properties = { APP_ENV: 'staging', GOOGLE_CLIENT_IDS: 'test.apps.googleusercontent.com' };
  const cache = new Map();
  let fetched = 0,
    writes = 0,
    held = false;
  const now = Math.floor(Date.now() / 1000);
  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] ?? null,
        setProperty: (key, value) => {
          properties[key] = value;
          writes += 1;
        },
      }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'chef@gmail.com' }) },
    Utilities: {
      getUuid: () => 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
      base64DecodeWebSafe: (text) => [...Buffer.from(text, 'base64url')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) ?? null,
        put: (key, value) => cache.set(key, value),
      }),
    },
    UrlFetchApp: {
      fetch: (url) => {
        assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
        fetched += 1;
        return {
          getResponseCode: () => 200,
          getHeaders: () => ({ 'Cache-Control': 'public, max-age=3600' }),
          getContentText: () =>
            JSON.stringify({ keys: [{ ...jwk, kid: 'runtime-key', alg: 'RS256', use: 'sig' }] }),
        };
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          assert.equal(held, false);
          held = true;
          return true;
        },
        releaseLock: () => {
          held = false;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType: () => text }),
    },
    console: { info: () => {} },
  };
  // Crypto, TextEncoder, atob, Buffer, fetch and Node globals are absent in this context.
  runInNewContext(code, sandbox, { timeout: 5000 });
  assert.equal(sandbox.setupStagingAuth().configured, true);
  const policy = properties.STAGING_INVITES;
  sandbox.setupStagingAuth();
  assert.equal(properties.STAGING_INVITES, policy);
  const claims = {
    iss: 'https://accounts.google.com',
    aud: properties.GOOGLE_CLIENT_IDS,
    sub: 'runtime-sub',
    email: 'chef@gmail.com',
    email_verified: true,
    name: 'Повар',
    iat: now - 10,
    exp: now + 3600,
  };
  function jwt(overrides = {}) {
    const data = [
      { alg: 'RS256', typ: 'JWT', kid: 'runtime-key' },
      { ...claims, ...overrides },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.');
    return (
      data + '.' + sign('RSA-SHA256', Buffer.from(data), pair.privateKey).toString('base64url')
    );
  }
  function request(credential, action = 'auth.signIn') {
    return JSON.parse(
      sandbox.doPost({
        postData: {
          contents: JSON.stringify({
            apiVersion: 1,
            requestId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
            action,
            credential,
            payload: {},
          }),
        },
      }),
    );
  }
  assert.equal(request(jwt(), 'auth.me').error.code, 'ACCESS_DENIED');
  const result = request(jwt());
  assert.equal(result.ok, true);
  assert.equal(result.data.user.id, 'runtime-sub');
  assert.equal(result.data.user.name, 'Повар');
  assert.equal(writes, 2); // one invitation policy, one atomic claim
  assert.equal(request(jwt(), 'auth.me').ok, true);
  assert.equal(writes, 2);
  assert.equal(fetched, 3); // two owner setup probes, one cached verifier fetch
  assert.equal(request(jwt({ sub: 'another-sub' })).error.code, 'ACCESS_DENIED');
  assert.equal(request(jwt({ exp: now - 1 })).error.code, 'UNAUTHENTICATED');
  assert.equal(
    request(jwt({ email: 'stranger@gmail.com', sub: 'stranger' })).error.code,
    'ACCESS_DENIED',
  );
  properties.STAGING_INVITES = JSON.stringify([
    { email: 'someone@gmail.com', role: 'viewer', expiresAt: '2027-01-01T00:00:00Z' },
  ]);
  assert.equal(request(jwt(), 'auth.me').error.code, 'ACCESS_DENIED');
  assert.equal(held, false);
  delete properties.GOOGLE_CLIENT_IDS;
  sandbox.setupStagingAuth();
  assert.equal(
    properties.GOOGLE_CLIENT_IDS,
    '808057643126-ih11h368gu15lbdlm63g1fmihre3v9s3.apps.googleusercontent.com',
  );
  assert.equal(request(jwt(), 'auth.me').error.code, 'UNAUTHENTICATED');
  assert.equal(held, false);
  console.log(
    'Apps Script: real RS256 verification, cached Google keys, invitation claim/revocation passed without WebCrypto.',
  );
}
