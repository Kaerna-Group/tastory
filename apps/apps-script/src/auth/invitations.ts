import { z } from 'zod';
import { AuthError } from './google-token';
import type { GoogleIdentity } from './google-token';

export const invitationsSchema = z
  .array(
    z.strictObject({
      email: z
        .email()
        .max(254)
        .transform((email) => email.toLowerCase()),
      role: z.enum(['owner', 'member', 'viewer']),
      expiresAt: z.iso.datetime(),
    }),
  )
  .max(10)
  .refine((items) => new Set(items.map((item) => item.email)).size === items.length);
export const bindingsSchema = z
  .array(
    z.strictObject({
      email: z.email().max(254),
      sub: z.string().min(1).max(255),
      joinedAt: z.iso.datetime(),
    }),
  )
  .max(10)
  .refine(
    (items) =>
      new Set(items.map((item) => item.email)).size === items.length &&
      new Set(items.map((item) => item.sub)).size === items.length,
  );
export type Invitations = z.infer<typeof invitationsSchema>;
export type Bindings = z.infer<typeof bindingsSchema>;

// Called under one ScriptLock; a single property write consumes an invitation and
// binds the stable Google sub. Removing an invitation revokes its existing binding.
export function admitIdentity(
  identity: GoogleIdentity,
  invitations: Invitations,
  bindings: Bindings,
  now: Date,
  allowJoin: boolean,
) {
  const existing = bindings.find((binding) => binding.sub === identity.sub);
  const invitation = invitations.find(
    (invite) => invite.email === (existing?.email ?? identity.email),
  );
  if (!invitation) throw new AuthError('ACCESS_DENIED');
  if (!existing) {
    if (
      !allowJoin ||
      !identity.emailAuthoritative ||
      Date.parse(invitation.expiresAt) <= now.getTime() ||
      bindings.some((binding) => binding.email === invitation.email) ||
      bindings.length >= 10
    )
      throw new AuthError('ACCESS_DENIED');
    bindings.push({ email: invitation.email, sub: identity.sub, joinedAt: now.toISOString() });
  }
  return {
    user: { id: identity.sub, email: identity.email, name: identity.name, role: invitation.role },
    expiresAt: identity.expiresAt,
  };
}
