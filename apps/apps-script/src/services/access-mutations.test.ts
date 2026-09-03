import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessCommand, AccessWrite, AuthData } from '@tastory/contracts';
import { accessResponseSchema, apiRequestSchema } from '@tastory/contracts';
import {
  fixture,
  owner,
  viewer,
  workspace,
  timestamp,
  sha256,
  options as migrationOptions,
} from '../test-support/journal-fixture';
import { applyJournalSchema } from './journal-migration';
import {
  accessDirectory,
  accessInvites,
  accessRevision,
  acceptInvitation,
  mutateAccess,
  pendingAccess,
  resumeAccess,
} from './access-mutations';
import { createAccessStore } from '../platform/access-store';
import { readJournal, runJournalCheck } from './operation-journal';
import { manageAccess } from '../platform/access-admin';
import { authenticateSheets } from '../platform/workspace-directory';
import { handleRequest } from '../controllers/handle-request';

const actor = { userId: owner, workspaceId: workspace };
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture');
  return value;
}
const options = { now: () => new Date(), uuid: randomUUID, sha256, assertLive: () => {} };
const newIdentity = {
  sub: 'new-google-sub',
  email: 'new@example.test',
  name: 'Новый участник',
  emailAuthoritative: true,
  expiresAt: '2026-09-03T14:00:00.000Z',
};
const ownerSession: AuthData = {
  user: { id: 'owner-sub', email: 'owner@example.test', name: 'Владелец', role: 'owner' },
  expiresAt: newIdentity.expiresAt,
};
const setup = () => {
  const state = fixture();
  applyJournalSchema(state.store, migrationOptions);
  state.fail();
  return { ...state, access: createAccessStore(state.book) };
};
const create = (revision = 1, email = newIdentity.email): AccessWrite => ({
  action: 'admin.invites.create',
  payload: { email, role: 'viewer', days: 7, expectedRevision: revision },
});
const update = (revision = 1, status: 'active' | 'disabled' = 'active'): AccessWrite => ({
  action: 'admin.members.update',
  payload: { userId: viewer, role: 'member', status, expectedRevision: revision },
});
function mutation(state: ReturnType<typeof setup>, command: AccessWrite, requestId = randomUUID()) {
  state.hold();
  return mutateAccess(state.access, command, requestId, actor, options);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('invitations and membership writes', () => {
  it('creates a normalized invitation, replays after later writes and increments revision once per mutation', () => {
    const state = setup(),
      id = randomUUID();
    const command = create(1, 'NEW@example.test');
    const first = mutation(state, command, id);
    expect(accessInvites(state.access)[0]).toMatchObject({
      email_normalized: newIdentity.email,
      role: 'viewer',
      status: 'pending',
    });
    expect(accessRevision(state.access)).toBe(2);
    mutation(state, update(2));
    state.fail();
    expect(mutation(state, command, id)).toEqual({ ...first, outcome: 'replayed' });
    expect(state.count()).toBe(0);
    expect(accessRevision(state.access)).toBe(3);
    expect(readJournal(state.store).audit).toHaveLength(2);
    expect(() => mutation(state, create(1, 'different@example.test'), id)).toThrow(
      'OPERATION_MISMATCH',
    );
    expect(() => mutation(state, create(1, 'different@example.test'))).toThrow('ACCESS_CONFLICT');
  });
  it('rejects duplicate/live addresses, existing users, owner promotion and owner removal', () => {
    const state = setup();
    mutation(state, create());
    state.fail();
    expect(() => mutation(state, create(2))).toThrow('ACCESS_INVALID');
    expect(() => mutation(state, create(2, 'viewer@example.test'))).toThrow('ACCESS_INVALID');
    expect(() =>
      mutation(state, {
        action: 'admin.members.update',
        payload: { userId: owner, role: 'viewer', status: 'disabled', expectedRevision: 2 },
      }),
    ).toThrow('ACCESS_INVALID');
    expect(
      apiRequestSchema.safeParse({
        apiVersion: 1,
        requestId: randomUUID(),
        credential: 'token',
        action: 'admin.members.update',
        payload: { userId: viewer, role: 'owner', status: 'active', expectedRevision: 2 },
      }).success,
    ).toBe(false);
    expect(state.count()).toBe(0);
  });
  it('changes roles, revokes current sessions and restores membership with row revisions', () => {
    const state = setup();
    mutation(state, update());
    expect(accessDirectory(state.access).members[1]).toMatchObject({
      role: 'member',
      row_revision: '2',
    });
    const identity = { ...newIdentity, sub: 'viewer-sub', email: 'viewer@example.test' };
    const config = state.properties.SHEETS_AUTH_CONFIG ?? '';
    expect(authenticateSheets(identity, config, 'private-sheet').user.role).toBe('member');
    mutation(state, update(2, 'disabled'));
    expect(() => authenticateSheets(identity, config, 'private-sheet', true)).toThrow(
      'ACCESS_DENIED',
    );
    mutation(state, update(3));
    expect(authenticateSheets(identity, config, 'private-sheet').user.role).toBe('member');
    expect(accessDirectory(state.access).members[1]?.row_revision).toBe('4');
  });
  it('rejects viewer writes, a revoked owner, unknown targets and no-op updates', () => {
    const state = setup();
    expect(() =>
      mutateAccess(
        state.access,
        create(),
        randomUUID(),
        { userId: viewer, workspaceId: workspace },
        options,
      ),
    ).toThrow('ACCESS_DENIED');
    expect(() =>
      mutation(state, {
        action: 'admin.members.update',
        payload: { userId: viewer, role: 'viewer', status: 'active', expectedRevision: 1 },
      }),
    ).toThrow('ACCESS_INVALID');
    expect(() =>
      mutation(state, {
        action: 'admin.members.update',
        payload: { userId: randomUUID(), role: 'viewer', status: 'active', expectedRevision: 1 },
      }),
    ).toThrow('ACCESS_INVALID');
    required(state.required('WorkspaceMembers')[1])[3] = 'disabled';
    expect(() => mutation(state, create())).toThrow('ACCESS_DENIED');
    expect(state.count()).toBe(0);
  });
  it('revokes an unused invitation, blocks its claim and permits a new invitation', () => {
    const state = setup(),
      first = mutation(state, create());
    mutation(state, {
      action: 'admin.invites.revoke',
      payload: { inviteId: first.entityId, expectedRevision: 2 },
    });
    expect(() => acceptInvitation(state.access, newIdentity, workspace, true, options)).toThrow(
      'ACCESS_DENIED',
    );
    mutation(state, create(3));
    acceptInvitation(state.access, newIdentity, workspace, true, options);
    expect(accessInvites(state.access).map((i) => i.status)).toEqual(['revoked', 'used']);
    expect(accessDirectory(state.access).users).toHaveLength(3);
    expect(accessRevision(state.access)).toBe(5);
  });
  it('accepts only the authoritative invited email on signIn, never on auth.me', () => {
    const state = setup();
    mutation(state, create());
    state.fail();
    for (const identity of [
      { ...newIdentity, email: 'stranger@example.test' },
      { ...newIdentity, emailAuthoritative: false },
      { ...newIdentity, email: 'viewer@example.test' },
    ])
      expect(() => acceptInvitation(state.access, identity, workspace, true, options)).toThrow(
        'ACCESS_DENIED',
      );
    expect(() => acceptInvitation(state.access, newIdentity, workspace, false, options)).toThrow(
      'ACCESS_DENIED',
    );
    expect(state.count()).toBe(0);
    const config = state.properties.SHEETS_AUTH_CONFIG ?? '';
    const joined = authenticateSheets(newIdentity, config, 'private-sheet', true);
    expect(joined.user).toMatchObject({ id: newIdentity.sub, role: 'viewer' });
    expect(accessInvites(state.access)[0]?.status).toBe('used');
    state.fail();
    authenticateSheets(newIdentity, config, 'private-sheet', true);
    expect(state.count()).toBe(0);
    expect(readJournal(state.store).operations).toHaveLength(2);
  });
  it('refuses expired/reused invitations and expired credentials without effects', () => {
    const state = setup();
    mutation(state, create());
    state.fail();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    expect(() => acceptInvitation(state.access, newIdentity, workspace, true, options)).toThrow(
      'ACCESS_DENIED',
    );
    expect(() => manageAccess(create(2), randomUUID(), ownerSession)).toThrow('UNAUTHENTICATED');
    expect(state.count()).toBe(0);
  });
  it('limits pending slots and rejects formula input before creating a journal operation', () => {
    const state = setup();
    for (let i = 0; i < 8; i++) mutation(state, create(i + 1, `guest${i}@example.test`));
    state.fail();
    expect(() => mutation(state, create(9))).toThrow('ACCESS_LIMIT');
    expect(() => mutation(state, create(9, '=bad@example.test'))).toThrow();
    expect(state.count()).toBe(0);
  });
});

describe('durable access recovery', () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    'recovers invitation creation before/after storage boundary %i',
    (at) => {
      for (const after of [false, true]) {
        const state = setup(),
          id = randomUUID();
        state.fail(at, after);
        expect(() => mutation(state, create(), id)).toThrow();
        state.fail();
        mutation(state, create(), id);
        expect(accessInvites(state.access)).toHaveLength(1);
        expect(accessRevision(state.access)).toBe(2);
        expect(readJournal(state.store).operations).toHaveLength(1);
        expect(readJournal(state.store).audit).toHaveLength(1);
        state.fail();
        expect(mutation(state, create(), id).outcome).toBe('replayed');
        expect(state.count()).toBe(0);
      }
    },
  );
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    'recovers member change before/after storage boundary %i',
    (at) => {
      for (const after of [false, true]) {
        const state = setup(),
          id = randomUUID();
        state.fail(at, after);
        expect(() => mutation(state, update(), id)).toThrow();
        state.fail();
        mutation(state, update(), id);
        expect(accessDirectory(state.access).members[1]).toMatchObject({
          role: 'member',
          row_revision: '2',
        });
        expect(accessRevision(state.access)).toBe(2);
        expect(readJournal(state.store).audit).toHaveLength(1);
      }
    },
  );
  it.each(Array.from({ length: 14 }, (_, i) => i + 1))(
    'recovers invitation acceptance before/after storage boundary %i',
    (at) => {
      for (const after of [false, true]) {
        const state = setup();
        mutation(state, create());
        state.fail(at, after);
        expect(() =>
          acceptInvitation(state.access, newIdentity, workspace, true, options),
        ).toThrow();
        state.fail();
        const pending = pendingAccess(state.access)[0];
        if (pending) {
          expect(() => mutation(state, update(accessRevision(state.access)))).toThrow(
            'ACCESS_PENDING',
          );
          expect(() =>
            acceptInvitation(state.access, newIdentity, workspace, false, options),
          ).toThrow('ACCESS_DENIED');
        }
        acceptInvitation(state.access, newIdentity, workspace, true, options);
        expect(accessDirectory(state.access).users).toHaveLength(3);
        expect(accessDirectory(state.access).members).toHaveLength(3);
        expect(accessInvites(state.access)[0]?.status).toBe('used');
        expect(accessRevision(state.access)).toBe(3);
        expect(readJournal(state.store).audit).toHaveLength(2);
        state.fail();
        acceptInvitation(state.access, newIdentity, workspace, true, options);
        expect(state.count()).toBe(0);
      }
    },
  );
  it('owner can resume an interrupted join without changing its actor; health reads remain possible', () => {
    const state = setup();
    mutation(state, create());
    state.fail(5);
    expect(() => acceptInvitation(state.access, newIdentity, workspace, true, options)).toThrow();
    state.fail();
    const op = required(pendingAccess(state.access)[0]);
    const list = manageAccess(
      { action: 'admin.access.list', payload: {} },
      randomUUID(),
      ownerSession,
    );
    expect(list).toMatchObject({
      kind: 'access',
      pending: [{ id: op.request_id, canResume: true }],
    });
    const result = manageAccess(
      { action: 'admin.access.resume', payload: { operationId: op.request_id } },
      randomUUID(),
      ownerSession,
    );
    expect(result).toMatchObject({ outcome: 'committed', operationId: op.request_id });
    expect(readJournal(state.store).audit.at(-1)?.user_id).toBe(op.user_id);
  });
  it('refuses changed rows and malformed plans without overwriting data', () => {
    const state = setup();
    state.fail(3);
    expect(() => mutation(state, update())).toThrow();
    state.fail();
    const op = required(pendingAccess(state.access)[0]);
    required(state.required('WorkspaceMembers')[2])[5] = '90';
    expect(() => resumeAccess(state.access, op, options)).toThrow('ACCESS_UNAVAILABLE');
    expect(state.count()).toBe(0);
    expect(state.required('WorkspaceMembers')[2]?.[5]).toBe('90');
  });
  it('checks expiry before every write and permits a later authorized recovery', () => {
    const state = setup();
    let checks = 0;
    expect(() =>
      mutateAccess(state.access, create(), randomUUID(), actor, {
        ...options,
        assertLive() {
          if (++checks === 4) throw new Error('expired');
        },
      }),
    ).toThrow('expired');
    const op = required(pendingAccess(state.access)[0]);
    expect(op).toBeDefined();
    resumeAccess(state.access, op, options);
    expect(accessRevision(state.access)).toBe(2);
  });
  it('keeps old journal checks readable beside access events', () => {
    const state = setup();
    const id = randomUUID();
    runJournalCheck(
      state.store,
      { ...actor, requestId: id },
      { now: options.now, sha256, assertAuthorized: options.assertLive },
    );
    mutation(state, update());
    expect(
      runJournalCheck(
        state.store,
        { ...actor, requestId: id },
        { now: options.now, sha256, assertAuthorized: options.assertLive },
      ).outcome,
    ).toBe('replayed');
    expect(readJournal(state.store).operations).toHaveLength(2);
  });
});

describe('protected access endpoint', () => {
  it('passes only the validated command to the writer and never stores the credential', () => {
    const state = setup();
    const response = handleRequest(
      {
        ...create(),
        apiVersion: 1,
        requestId: randomUUID(),
        credential: 'private-synthetic-token',
      },
      {
        now: options.now,
        createRequestId: randomUUID,
        isEchoEnabled: false,
        deploymentVersion: 'test',
        authenticate: () => ownerSession,
        access: manageAccess,
      },
    );
    expect(accessResponseSchema.parse(response)).toMatchObject({
      ok: true,
      data: { kind: 'saved', revision: 2 },
    });
    expect(JSON.stringify([...state.sheets])).not.toContain('private-synthetic-token');
  });
  it('validates envelopes and rejects viewer, injected identity and a revoked owner', () => {
    const state = setup();
    const command: AccessCommand = { action: 'admin.access.list', payload: {} };
    const request = { ...command, requestId: randomUUID(), credential: 'token', apiVersion: 1 };
    const context = {
      now: options.now,
      createRequestId: randomUUID,
      isEchoEnabled: false,
      deploymentVersion: 'test',
      authenticate: () => ownerSession,
      access: manageAccess,
    };
    expect(accessResponseSchema.parse(handleRequest(request, context)).ok).toBe(true);
    expect(
      handleRequest(request, {
        ...context,
        authenticate: () => ({
          ...ownerSession,
          user: { ...ownerSession.user, role: 'viewer' as const },
        }),
      }),
    ).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
    expect(
      handleRequest({ ...request, payload: { workspaceId: randomUUID() } }, context),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    required(state.required('WorkspaceMembers')[1])[3] = 'disabled';
    expect(handleRequest(request, context)).toMatchObject({
      ok: false,
      error: { code: 'ACCESS_DENIED' },
    });
  });
  it('fails closed for busy lock, missing configuration, corruption and foreign resume requests', () => {
    const state = setup();
    state.lock.mockReturnValueOnce(false);
    expect(() => manageAccess(create(), randomUUID(), ownerSession)).toThrow('ACCESS_UNAVAILABLE');
    expect(() =>
      manageAccess(
        { action: 'admin.access.resume', payload: { operationId: randomUUID() } },
        randomUUID(),
        ownerSession,
      ),
    ).toThrow('ACCESS_DENIED');
    state.formulas.add('Invites');
    expect(() =>
      manageAccess({ action: 'admin.access.list', payload: {} }, randomUUID(), ownerSession),
    ).toThrow('ACCESS_UNAVAILABLE');
    state.formulas.clear();
    state.properties.APP_ENV = 'production';
    expect(() => manageAccess(create(), randomUUID(), ownerSession)).toThrow('ACCESS_UNAVAILABLE');
  });
});
