import { PKCS1_SHA256 } from 'micro-rsa-dsa-dh/rsa.js';
import { z } from 'zod';

export class AuthError extends Error {
  constructor(
    public readonly code:
      'AUTH_NOT_CONFIGURED' | 'UNAUTHENTICATED' | 'ACCESS_DENIED' | 'AUTH_UNAVAILABLE',
  ) {
    super(code);
  }
}

const encoded = z.string().regex(/^[A-Za-z0-9_-]+$/);
const headerSchema = z.strictObject({
  alg: z.literal('RS256'),
  kid: encoded.max(128),
  typ: z.literal('JWT').optional(),
});
export const googleKeysSchema = z.object({
  keys: z
    .array(
      z.object({
        kty: z.literal('RSA'),
        alg: z.literal('RS256'),
        use: z.literal('sig'),
        kid: encoded.max(128),
        n: encoded.max(684),
        e: z.literal('AQAB'),
      }),
    )
    .min(1)
    .max(10),
});
export type GoogleKey = z.infer<typeof googleKeysSchema>['keys'][number];
const claimsSchema = z.object({
  iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  aud: z.string(),
  azp: z.string().optional(),
  sub: z.string().min(1).max(255),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
  nbf: z.number().int().positive().optional(),
  email: z.email().max(254),
  email_verified: z.literal(true),
  hd: z
    .string()
    .min(1)
    .max(253)
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
    )
    .optional(),
  name: z.string().max(200).optional(),
});
export type GoogleIdentity = Readonly<{
  sub: string;
  email: string;
  name: string;
  expiresAt: string;
  emailAuthoritative: boolean;
}>;
export type TokenDependencies = Readonly<{
  audiences: readonly string[];
  now: () => Date;
  decodeBase64: (value: string) => Uint8Array;
  decodeJson: (value: string) => unknown;
  getKey: (kid: string) => GoogleKey | undefined;
}>;

// Only Google's RS256 ID tokens. RSA/padding/SHA-256 are provided by the library;
// this bounded adapter validates the Google claims. See ADR 0004 (staging only).
export function verifyGoogleToken(token: string, deps: TokenDependencies): GoogleIdentity {
  if (!deps.audiences.length) throw new AuthError('AUTH_NOT_CONFIGURED');
  try {
    if (token.length > 6144 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error();
    const [headerPart = '', payloadPart = '', signaturePart = ''] = token.split('.');
    const header = headerSchema.parse(deps.decodeJson(headerPart));
    const claims = claimsSchema.parse(deps.decodeJson(payloadPart));
    const now = Math.floor(deps.now().getTime() / 1000);
    if (
      !deps.audiences.includes(claims.aud) ||
      (claims.azp !== undefined && claims.azp !== claims.aud) ||
      claims.exp <= now ||
      claims.iat > now + 60 ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 7200 ||
      (claims.nbf !== undefined && claims.nbf > now)
    )
      throw new Error();
    const key = deps.getKey(header.kid);
    if (!key) throw new Error();
    const modulus = deps.decodeBase64(key.n);
    if (modulus.length < 256 || modulus.length > 512 || (modulus[0] ?? 0) < 128) throw new Error();
    const n = BigInt(
      '0x' + Array.from(modulus, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
    const message = Uint8Array.from(`${headerPart}.${payloadPart}`, (char) => char.charCodeAt(0));
    // Apps Script's upload parser rejects bigint literal syntax despite V8 BigInt support.
    if (!PKCS1_SHA256.verify({ n, e: BigInt(65537) }, message, deps.decodeBase64(signaturePart)))
      throw new Error();
    const email = claims.email.toLowerCase();
    return {
      sub: claims.sub,
      email,
      name: claims.name || email,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      emailAuthoritative: email.endsWith('@gmail.com') || claims.hd !== undefined,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('UNAUTHENTICATED');
  }
}
