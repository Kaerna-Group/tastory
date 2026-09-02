import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthError, verifyGoogleToken } from './google-token';
import type { GoogleKey, TokenDependencies } from './google-token';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = pair.publicKey.export({ format: 'jwk' });
const key: GoogleKey = {
  kty: 'RSA',
  alg: 'RS256',
  use: 'sig',
  kid: 'test-key',
  n: jwk.n ?? '',
  e: 'AQAB',
};
const now = 1_788_393_600;
const claims = {
  iss: 'https://accounts.google.com',
  aud: 'test.apps.googleusercontent.com',
  sub: 'google-sub-1',
  iat: now - 10,
  exp: now + 3600,
  email: 'Chef@gmail.com',
  email_verified: true,
  name: 'Повар',
};
function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const data = [
    { alg: 'RS256', kid: 'test-key', typ: 'JWT', ...header },
    { ...claims, ...overrides },
  ]
    .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
    .join('.');
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), pair.privateKey).toString('base64url');
}
const deps: TokenDependencies = {
  audiences: [claims.aud],
  now: () => new Date(now * 1000),
  decodeBase64: (value) => new Uint8Array(Buffer.from(value, 'base64url')),
  decodeJson: (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown,
  getKey: (kid) => (kid === key.kid ? key : undefined),
};

describe('Google signature and claims', () => {
  it('verifies an actual RSA signature and returns the stable subject', () => {
    expect(verifyGoogleToken(token(), deps)).toMatchObject({
      sub: claims.sub,
      email: 'chef@gmail.com',
      name: 'Повар',
      emailAuthoritative: true,
    });
  });
  it('accepts the second Google issuer and matching authorized party', () => {
    expect(
      verifyGoogleToken(
        token({ iss: 'accounts.google.com', azp: claims.aud, nbf: now - 1, name: undefined }),
        deps,
      ).name,
    ).toBe('chef@gmail.com');
  });
  it('distinguishes third party addresses from Workspace', () => {
    expect(verifyGoogleToken(token({ email: 'chef@example.com' }), deps).emailAuthoritative).toBe(
      false,
    );
    expect(
      verifyGoogleToken(token({ email: 'chef@example.com', hd: 'example.com' }), deps)
        .emailAuthoritative,
    ).toBe(true);
  });
  it.each([
    { aud: 'other.apps.googleusercontent.com' },
    { iss: 'https://evil.test' },
    { exp: now },
    { exp: now - 1 },
    { email_verified: false },
    { email_verified: 'true' },
    { email: 'invalid' },
    { sub: '' },
    { sub: undefined },
    { iat: now + 61 },
    { exp: now + 8000 },
    { iat: now + 20, exp: now + 10 },
    { nbf: now + 1 },
    { azp: 'other.apps.googleusercontent.com' },
    { exp: '9999999999' },
    { aud: [claims.aud] },
  ])('rejects invalid signed claims %j', (overrides) => {
    expect(() => verifyGoogleToken(token(overrides), deps)).toThrow('UNAUTHENTICATED');
  });
  it.each([
    { alg: 'none' },
    { alg: 'HS256' },
    { kid: 'unknown' },
    { jku: 'https://evil.test' },
    { crit: ['b64'], b64: false },
  ])('rejects algorithm/key substitution %j', (header) => {
    expect(() => verifyGoogleToken(token({}, header), deps)).toThrow('UNAUTHENTICATED');
  });
  it('rejects tampered payload and signature', () => {
    const parts = token().split('.');
    const altered = Buffer.from(JSON.stringify({ ...claims, sub: 'attacker' })).toString(
      'base64url',
    );
    expect(() => verifyGoogleToken(`${parts[0]}.${altered}.${parts[2]}`, deps)).toThrow(
      'UNAUTHENTICATED',
    );
    expect(() => verifyGoogleToken(`${parts[0]}.${parts[1]}.${'A'.repeat(342)}`, deps)).toThrow(
      'UNAUTHENTICATED',
    );
  });
  it.each(['', 'a.b', 'a.b.c.d', '!!!.e30.c2ln', 'a'.repeat(6145), 'e30.e30.YQ'])(
    'rejects malformed/bounded input',
    (value) => {
      expect(() => verifyGoogleToken(value, deps)).toThrow('UNAUTHENTICATED');
    },
  );
  it('fails closed for absent config and failed key fetch', () => {
    expect(() => verifyGoogleToken(token(), { ...deps, audiences: [] })).toThrow(
      'AUTH_NOT_CONFIGURED',
    );
    expect(() =>
      verifyGoogleToken(token(), {
        ...deps,
        getKey: () => {
          throw new AuthError('AUTH_UNAVAILABLE');
        },
      }),
    ).toThrow('AUTH_UNAVAILABLE');
  });
  it('rejects undersized and unbounded imported moduli', () => {
    for (const size of [128, 513]) {
      expect(() =>
        verifyGoogleToken(token(), {
          ...deps,
          getKey: () => ({ ...key, n: Buffer.alloc(size, 255).toString('base64url') }),
        }),
      ).toThrow('UNAUTHENTICATED');
    }
  });
});
