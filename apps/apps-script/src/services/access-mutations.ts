import type { AccessWrite } from '@tastory/contracts';
import { accessWriteSchema } from '@tastory/contracts';
import { parseWorkspaceDirectory } from '../auth/workspace-access';
import type { WorkspaceDirectory } from '../auth/workspace-access';
import { AuthError } from '../auth/google-token';
import type { GoogleIdentity } from '../auth/google-token';
import { CORE_TABLES } from '../schema/core-schema';
import type { CoreTableName } from '../schema/core-schema';
import { JOURNAL_LIMIT } from '../schema/journal-schema';
import type { JournalStore } from './journal-migration';
import { readJournal, writeOperation, appendAudit } from './operation-journal';
import type { JournalOperation } from './operation-journal';
import { JournalError } from './journal-error';
import { AccessError, accessPlanSchema, inviteSchema, parseAccessPlan } from './access-model';
import type { AccessPlan } from './access-model';

export type AccessStore = {
  journal: JournalStore;
  rows: (table: CoreTableName) => string[][];
  write: (table: CoreTableName, row: number, values: readonly string[]) => void;
};
export type AccessOptions = {
  now: () => Date;
  uuid: () => string;
  sha256: (value: string) => string;
  assertLive: () => void;
};
type Actor = { userId: string; workspaceId: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function records(table: CoreTableName, rows: string[][]) {
  const columns = CORE_TABLES.find((t) => t.name === table)?.columns;
  if (!columns) throw new AccessError();
  return rows.map((row) => Object.fromEntries(columns.map((key, i) => [key, row[i] ?? ''])));
}
export function accessDirectory(store: AccessStore): WorkspaceDirectory {
  return parseWorkspaceDirectory({
    users: records('Users', store.rows('Users')),
    workspaces: records('Workspaces', store.rows('Workspaces')),
    members: records('WorkspaceMembers', store.rows('WorkspaceMembers')),
  });
}
export function accessRevision(store: AccessStore) {
  const rows = store.rows('Meta');
  const values = rows.filter((row) => row[0] === 'data_revision');
  const value = values[0]?.[1] ?? '';
  if (
    values.length !== 1 ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) >= Number.MAX_SAFE_INTEGER - 1
  )
    throw new AccessError();
  return Number(value);
}
export function accessInvites(store: AccessStore) {
  const invites = records('Invites', store.rows('Invites')).map((row) => {
    const parsed = inviteSchema.safeParse(row);
    if (!parsed.success) throw new AccessError();
    return parsed.data;
  });
  const directory = accessDirectory(store);
  if (
    new Set(invites.map((i) => i.invite_id)).size !== invites.length ||
    invites.some(
      (i) =>
        !directory.workspaces.some((w) => w.workspace_id === i.workspace_id) ||
        !directory.users.some((u) => u.user_id === i.invited_by) ||
        (i.used_by && !directory.users.some((u) => u.user_id === i.used_by)),
    )
  )
    throw new AccessError();
  return invites;
}
export function pendingAccess(store: AccessStore) {
  const pending = readJournal(store.journal).operations.filter(
    (op) => op.action !== 'admin.operations.check' && op.status === 'started',
  );
  if (pending.length > 1) throw new AccessError();
  return pending;
}
function writeFor(
  store: AccessStore,
  table: AccessPlan['writes'][number]['table'],
  index: number,
  after: string[],
): AccessPlan['writes'][number] {
  return { table, row: index + 2, before: store.rows(table)[index] ?? null, after };
}
function planWithRevision(
  store: AccessStore,
  entityId: string,
  writes: AccessPlan['writes'],
  options: AccessOptions,
): AccessPlan {
  const fromRevision = accessRevision(store);
  const index = store.rows('Meta').findIndex((row) => row[0] === 'data_revision');
  const plan = accessPlanSchema.parse({
    kind: 'access-write',
    version: 1,
    entityId,
    fromRevision,
    toRevision: fromRevision + 1,
    writes: [
      ...writes,
      writeFor(store, 'Meta', index, [
        'data_revision',
        String(fromRevision + 1),
        options.now().toISOString(),
      ]),
    ],
  });
  if (JSON.stringify(plan).length > 4096) throw new AccessError('ACCESS_LIMIT');
  return plan;
}
function ownerPlan(
  store: AccessStore,
  input: AccessWrite,
  actor: Actor,
  options: AccessOptions,
): AccessPlan {
  const command = accessWriteSchema.parse(input);
  if (command.payload.expectedRevision !== accessRevision(store))
    throw new AccessError('ACCESS_CONFLICT');
  const directory = accessDirectory(store),
    invites = accessInvites(store);
  const now = options.now();
  if (command.action === 'admin.invites.create') {
    const email = command.payload.email.toLowerCase();
    if (/^[=+\-@]/.test(email)) throw new AccessError('ACCESS_INVALID');
    const user = directory.users.find((u) => u.email_normalized === email);
    if (
      user ||
      invites.some(
        (i) =>
          i.workspace_id === actor.workspaceId &&
          i.email_normalized === email &&
          i.status === 'pending' &&
          Date.parse(i.expires_at) > now.getTime(),
      )
    )
      throw new AccessError('ACCESS_INVALID');
    const reserved = new Set(
      invites
        .filter((i) => i.status === 'pending' && Date.parse(i.expires_at) > now.getTime())
        .map((i) => i.email_normalized),
    );
    if (invites.length >= 100 || directory.users.length + reserved.size >= 10)
      throw new AccessError('ACCESS_LIMIT');
    const id = options.uuid();
    const row = [
      id,
      actor.workspaceId,
      email,
      command.payload.role,
      actor.userId,
      new Date(now.getTime() + command.payload.days * 86400_000).toISOString(),
      '',
      '',
      'pending',
    ];
    return planWithRevision(store, id, [writeFor(store, 'Invites', invites.length, row)], options);
  }
  if (command.action === 'admin.invites.revoke') {
    const index = invites.findIndex(
      (i) => i.invite_id === command.payload.inviteId && i.workspace_id === actor.workspaceId,
    );
    const invite = invites[index];
    if (!invite || invite.status !== 'pending') throw new AccessError('ACCESS_INVALID');
    const row = [...(store.rows('Invites')[index] ?? [])];
    row[8] = 'revoked';
    return planWithRevision(
      store,
      invite.invite_id,
      [writeFor(store, 'Invites', index, row)],
      options,
    );
  }
  const index = directory.members.findIndex(
    (m) => m.workspace_id === actor.workspaceId && m.user_id === command.payload.userId,
  );
  const member = directory.members[index];
  const user = directory.users.find((u) => u.user_id === command.payload.userId);
  if (
    !member ||
    member.role === 'owner' ||
    member.user_id === actor.userId ||
    !user ||
    user.status !== 'active'
  )
    throw new AccessError('ACCESS_INVALID');
  if (member.role === command.payload.role && member.status === command.payload.status)
    throw new AccessError('ACCESS_INVALID');
  const row = [...(store.rows('WorkspaceMembers')[index] ?? [])];
  const revision = Number(row[5]);
  if (!Number.isSafeInteger(revision + 1)) throw new AccessError();
  row[2] = command.payload.role;
  row[3] = command.payload.status;
  row[5] = String(revision + 1);
  return planWithRevision(
    store,
    member.user_id,
    [writeFor(store, 'WorkspaceMembers', index, row)],
    options,
  );
}

// A durable, bounded row plan is saved BEFORE any business write. Other access mutations wait
// for it to finish. Each transition accepts only the exact before/after state, never a blind retry.
function applyPlan(store: AccessStore, operation: JournalOperation, options: AccessOptions) {
  if (operation.action === 'admin.operations.check') throw new AccessError();
  const plan = parseAccessPlan(operation.result_json);
  validatePlan(store, operation, plan);
  const revision = accessRevision(store);
  if (revision !== plan.fromRevision && revision !== plan.toRevision) throw new AccessError();
  for (const write of plan.writes) {
    const rows = store.rows(write.table),
      actual = rows[write.row - 2] ?? null;
    if (!same(actual, write.before) && !same(actual, write.after)) throw new AccessError();
    if (write.before === null && write.row > rows.length + 2) throw new AccessError();
  }
  for (const write of plan.writes) {
    if (same(store.rows(write.table)[write.row - 2], write.after)) continue;
    options.assertLive();
    store.write(write.table, write.row, write.after);
    store.journal.flush();
    if (!same(store.rows(write.table)[write.row - 2], write.after)) throw new AccessError();
  }
  accessDirectory(store);
  accessInvites(store);
  let state = readJournal(store.journal);
  const existingAudit = state.audit.find((event) => event.request_id === operation.request_id);
  const beforeHash = options.sha256(JSON.stringify(plan.writes.map((w) => w.before)));
  const afterHash = options.sha256(JSON.stringify(plan.writes.map((w) => w.after)));
  if (
    existingAudit &&
    (existingAudit.before_hash !== beforeHash || existingAudit.after_hash !== afterHash)
  )
    throw new AccessError();
  const completedAt = existingAudit?.created_at ?? options.now().toISOString();
  if (!existingAudit) {
    options.assertLive();
    appendAudit(store.journal, state.audit.length, {
      event_id: operation.request_id,
      request_id: operation.request_id,
      workspace_id: operation.workspace_id,
      user_id: operation.user_id,
      entity_type: operation.entity_type,
      entity_id: operation.entity_id,
      action: operation.action,
      before_hash: beforeHash,
      after_hash: afterHash,
      metadata_json: '{"kind":"access-write"}',
      created_at: completedAt,
    });
    store.journal.flush();
  }
  state = readJournal(store.journal);
  if (!state.audit.some((event) => event.request_id === operation.request_id))
    throw new AccessError();
  options.assertLive();
  const committed = { ...operation, status: 'committed' as const, completed_at: completedAt };
  writeOperation(
    store.journal,
    state.operations.findIndex((op) => op.request_id === operation.request_id),
    committed,
  );
  store.journal.flush();
  if (
    !same(
      readJournal(store.journal).operations.find((op) => op.request_id === operation.request_id),
      committed,
    )
  )
    throw new AccessError();
  return plan;
}
function validatePlan(store: AccessStore, operation: JournalOperation, plan: AccessPlan) {
  const changes = plan.writes.filter((w) => w.table !== 'Meta');
  const first = changes[0];
  if (!first) throw new AccessError();
  const fieldChanges = (before: string[], after: string[], allowed: number[]) =>
    before.every((value, i) => allowed.includes(i) || after[i] === value);
  if (operation.action === 'admin.invites.create') {
    if (
      changes.length !== 1 ||
      first.table !== 'Invites' ||
      first.before !== null ||
      first.after[0] !== operation.entity_id ||
      first.after[1] !== operation.workspace_id ||
      first.after[4] !== operation.user_id ||
      !['member', 'viewer'].includes(first.after[3] ?? '') ||
      first.after[8] !== 'pending'
    )
      throw new AccessError();
  } else if (operation.action === 'admin.invites.revoke') {
    if (
      changes.length !== 1 ||
      first.table !== 'Invites' ||
      first.before?.[8] !== 'pending' ||
      first.after[8] !== 'revoked' ||
      first.after[0] !== operation.entity_id ||
      first.after[1] !== operation.workspace_id ||
      !fieldChanges(first.before, first.after, [8])
    )
      throw new AccessError();
  } else if (operation.action === 'admin.members.update') {
    if (
      changes.length !== 1 ||
      first.table !== 'WorkspaceMembers' ||
      !first.before ||
      first.before[2] === 'owner' ||
      first.after[0] !== operation.workspace_id ||
      first.after[1] !== operation.entity_id ||
      first.after[1] === operation.user_id ||
      !['member', 'viewer'].includes(first.after[2] ?? '') ||
      Number(first.after[5]) !== Number(first.before[5]) + 1 ||
      !fieldChanges(first.before, first.after, [2, 3, 5])
    )
      throw new AccessError();
  } else if (operation.action === 'auth.invite.accept') {
    const member = changes[1],
      invite = changes[2];
    if (
      changes.length !== 3 ||
      first.table !== 'Users' ||
      first.before !== null ||
      first.after[0] !== operation.user_id ||
      first.after[6] !== 'active' ||
      first.after[9] !== '1' ||
      member?.table !== 'WorkspaceMembers' ||
      member.before !== null ||
      member.after[0] !== operation.workspace_id ||
      member.after[1] !== operation.user_id ||
      member.after[3] !== 'active' ||
      member.after[5] !== '1' ||
      !['member', 'viewer'].includes(member.after[2] ?? '') ||
      invite?.table !== 'Invites' ||
      invite.before?.[8] !== 'pending' ||
      invite.after[0] !== operation.entity_id ||
      invite.after[1] !== operation.workspace_id ||
      invite.after[2] !== first.after[3] ||
      invite.after[3] !== member.after[2] ||
      invite.after[6] !== operation.user_id ||
      invite.after[8] !== 'used' ||
      !fieldChanges(invite.before, invite.after, [6, 7, 8])
    )
      throw new AccessError();
  } else throw new AccessError();
  const projected: AccessStore = {
    ...store,
    rows(table) {
      const rows = store.rows(table).map((row) => [...row]);
      for (const write of plan.writes.filter((w) => w.table === table))
        rows[write.row - 2] = write.after;
      return rows;
    },
  };
  accessDirectory(projected);
  accessInvites(projected);
}
function receipt(operation: JournalOperation, outcome: 'committed' | 'replayed') {
  const plan = parseAccessPlan(operation.result_json);
  return {
    kind: 'saved' as const,
    outcome,
    operationId: operation.request_id,
    entityId: plan.entityId,
    revision: plan.toRevision,
  };
}
export function resumeAccess(
  store: AccessStore,
  operation: JournalOperation,
  options: AccessOptions,
) {
  options.assertLive();
  if (operation.status === 'committed') return receipt(operation, 'replayed');
  applyPlan(store, operation, options);
  options.assertLive();
  return receipt(operation, 'committed');
}
function start(store: AccessStore, operation: JournalOperation, options: AccessOptions) {
  const state = readJournal(store.journal);
  if (pendingAccess(store).length) throw new AccessError('ACCESS_PENDING');
  validatePlan(store, operation, parseAccessPlan(operation.result_json));
  if (state.operations.length >= JOURNAL_LIMIT || state.audit.length >= JOURNAL_LIMIT)
    throw new JournalError('JOURNAL_LIMIT');
  options.assertLive();
  writeOperation(store.journal, state.operations.length, operation);
  store.journal.flush();
  if (!same(readJournal(store.journal).operations.at(-1), operation)) throw new AccessError();
  return resumeAccess(store, operation, options);
}
export function mutateAccess(
  store: AccessStore,
  command: AccessWrite,
  requestId: string,
  actor: Actor,
  options: AccessOptions,
) {
  options.assertLive();
  const directory = accessDirectory(store);
  if (
    !directory.users.some((u) => u.user_id === actor.userId && u.status === 'active') ||
    !directory.members.some(
      (m) =>
        m.workspace_id === actor.workspaceId &&
        m.user_id === actor.userId &&
        m.role === 'owner' &&
        m.status === 'active',
    )
  )
    throw new AuthError('ACCESS_DENIED');
  const canonical = accessWriteSchema.parse(command);
  if (canonical.action === 'admin.invites.create')
    canonical.payload.email = canonical.payload.email.toLowerCase();
  const hash = options.sha256(
    JSON.stringify({
      version: 1,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      ...canonical,
    }),
  );
  const previous = readJournal(store.journal).operations.find((op) => op.request_id === requestId);
  if (previous) {
    if (
      previous.user_id !== actor.userId ||
      previous.workspace_id !== actor.workspaceId ||
      previous.action !== canonical.action ||
      previous.payload_hash !== hash
    )
      throw new JournalError('OPERATION_MISMATCH');
    return resumeAccess(store, previous, options);
  }
  if (pendingAccess(store).length) throw new AccessError('ACCESS_PENDING');
  const plan = ownerPlan(store, canonical, actor, options);
  return start(
    store,
    {
      request_id: requestId,
      workspace_id: actor.workspaceId,
      user_id: actor.userId,
      action: canonical.action,
      entity_type: canonical.action === 'admin.members.update' ? 'membership' : 'invite',
      entity_id: plan.entityId,
      payload_hash: hash,
      status: 'started',
      result_json: JSON.stringify(plan),
      error_code: '',
      started_at: options.now().toISOString(),
      completed_at: '',
    },
    options,
  );
}

export function acceptInvitation(
  store: AccessStore,
  identity: GoogleIdentity,
  workspaceId: string,
  allowJoin: boolean,
  options: AccessOptions,
) {
  const pending = pendingAccess(store).find(
    (op) =>
      op.action === 'auth.invite.accept' &&
      op.workspace_id === workspaceId &&
      parseAccessPlan(op.result_json).writes.some(
        (w) => w.table === 'Users' && w.after[1] === identity.sub,
      ),
  );
  if (pending) {
    if (!allowJoin) throw new AuthError('ACCESS_DENIED');
    resumeAccess(store, pending, options);
    return;
  }
  const directory = accessDirectory(store);
  // An existing Google subject is governed only by its current membership, never by a new email invitation.
  if (directory.users.some((u) => u.google_sub === identity.sub)) return;
  if (!allowJoin) throw new AuthError('ACCESS_DENIED');
  if (!identity.emailAuthoritative) throw new AuthError('ACCESS_DENIED');
  if (directory.users.some((u) => u.email_normalized === identity.email.toLowerCase()))
    throw new AuthError('ACCESS_DENIED');
  if (pendingAccess(store).length) throw new AccessError('ACCESS_PENDING');
  const invites = accessInvites(store);
  const matches = invites.filter(
    (i) =>
      i.workspace_id === workspaceId &&
      i.email_normalized === identity.email.toLowerCase() &&
      i.status === 'pending' &&
      i.role !== 'owner' &&
      Date.parse(i.expires_at) > options.now().getTime(),
  );
  const invite = matches[0];
  if (matches.length !== 1 || !invite) throw new AuthError('ACCESS_DENIED');
  if (directory.users.length >= 10 || directory.members.length >= 100)
    throw new AccessError('ACCESS_LIMIT');
  const userId = options.uuid(),
    timestamp = options.now().toISOString();
  const name = /^[=+\-@\t\r\n]/.test(identity.name) ? '' : identity.name.slice(0, 200);
  const user = [
    userId,
    identity.sub,
    identity.email,
    identity.email.toLowerCase(),
    name,
    '',
    'active',
    timestamp,
    '',
    '1',
  ];
  const member = [workspaceId, userId, invite.role, 'active', timestamp, '1'];
  const index = invites.findIndex((i) => i.invite_id === invite.invite_id);
  const used = [...(store.rows('Invites')[index] ?? [])];
  used[6] = userId;
  used[7] = timestamp;
  used[8] = 'used';
  const plan = planWithRevision(
    store,
    invite.invite_id,
    [
      writeFor(store, 'Users', directory.users.length, user),
      writeFor(store, 'WorkspaceMembers', directory.members.length, member),
      writeFor(store, 'Invites', index, used),
    ],
    options,
  );
  start(
    store,
    {
      request_id: options.uuid(),
      workspace_id: workspaceId,
      user_id: userId,
      action: 'auth.invite.accept',
      entity_type: 'invite',
      entity_id: invite.invite_id,
      payload_hash: options.sha256(
        JSON.stringify({ inviteId: invite.invite_id, subject: identity.sub }),
      ),
      status: 'started',
      result_json: JSON.stringify(plan),
      error_code: '',
      started_at: timestamp,
      completed_at: '',
    },
    options,
  );
}
