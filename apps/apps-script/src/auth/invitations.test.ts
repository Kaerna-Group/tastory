import { describe, expect, it } from 'vitest';
import { admitIdentity, invitationsSchema } from './invitations';
import type { Bindings, Invitations } from './invitations';
const now = new Date('2026-09-03T12:00:00Z');
const identity = {
  sub: 'stable-sub',
  email: 'chef@gmail.com',
  name: 'Chef',
  emailAuthoritative: true,
  expiresAt: '2026-09-03T13:00:00Z',
};
const invite: Invitations[number] = {
  email: identity.email,
  role: 'owner',
  expiresAt: '2026-09-10T12:00:00Z',
};
const invites: Invitations = [invite];
describe('staging invitation admission', () => {
  it('consumes an invitation exactly once; auth.me reuses its stable sub', () => {
    const bindings: Bindings = [];
    expect(admitIdentity(identity, invites, bindings, now, true).user.role).toBe('owner');
    admitIdentity(identity, invites, bindings, now, true);
    expect(
      admitIdentity({ ...identity, email: 'changed@gmail.com' }, invites, bindings, now, false).user
        .id,
    ).toBe(identity.sub);
    expect(bindings).toHaveLength(1);
  });
  it('cannot claim the same invitation with another sub', () => {
    const bindings: Bindings = [];
    admitIdentity(identity, invites, bindings, now, true);
    expect(() =>
      admitIdentity({ ...identity, sub: 'other' }, invites, bindings, now, true),
    ).toThrow('ACCESS_DENIED');
    expect(bindings).toHaveLength(1);
  });
  it('applies revocation and role changes on every request', () => {
    const bindings: Bindings = [];
    admitIdentity(identity, invites, bindings, now, true);
    expect(() => admitIdentity(identity, [], bindings, now, false)).toThrow('ACCESS_DENIED');
    expect(
      admitIdentity(identity, [{ ...invite, role: 'viewer' }], bindings, now, false).user.role,
    ).toBe('viewer');
  });
  it('denies uninvited, third party email, expired invite and auth.me before signup', () => {
    expect(() =>
      admitIdentity({ ...identity, email: 'stranger@gmail.com' }, invites, [], now, true),
    ).toThrow('ACCESS_DENIED');
    expect(() =>
      admitIdentity({ ...identity, emailAuthoritative: false }, invites, [], now, true),
    ).toThrow('ACCESS_DENIED');
    expect(() =>
      admitIdentity(identity, [{ ...invite, expiresAt: now.toISOString() }], [], now, true),
    ).toThrow('ACCESS_DENIED');
    expect(() => admitIdentity(identity, invites, [], now, false)).toThrow('ACCESS_DENIED');
  });
  it('expiry only limits claiming; established binding remains usable', () => {
    const bindings: Bindings = [
      { email: identity.email, sub: identity.sub, joinedAt: now.toISOString() },
    ];
    expect(
      admitIdentity(identity, [{ ...invite, expiresAt: now.toISOString() }], bindings, now, false)
        .user.id,
    ).toBe(identity.sub);
  });
  it('rejects duplicate invitations after email normalization', () => {
    expect(
      invitationsSchema.safeParse([invites[0], { ...invites[0], email: 'CHEF@gmail.com' }]).success,
    ).toBe(false);
  });
  it('bounds first-login storage', () => {
    const bindings = Array.from({ length: 10 }, (_, i) => ({
      email: `${i}@gmail.com`,
      sub: `sub-${i}`,
      joinedAt: now.toISOString(),
    }));
    expect(() => admitIdentity(identity, invites, bindings, now, true)).toThrow('ACCESS_DENIED');
  });
});
