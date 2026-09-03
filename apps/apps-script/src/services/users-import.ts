import { z } from 'zod';
import { bindingsSchema, invitationsSchema } from '../auth/invitations';
import type { SchemaStore } from './core-migration';

export const USERS_IMPORT_KEY = 'users_import_v1';
export const IDENTITY_TABLES = ['Users', 'Workspaces', 'WorkspaceMembers', 'Invites'] as const;
export type IdentityTable = (typeof IDENTITY_TABLES)[number];
export type UsersImportStore = SchemaStore & {
  readIdentityRows: (table: IdentityTable) => readonly (readonly string[])[];
};
export class UsersImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly table?: IdentityTable,
  ) {
    super(code);
  }
}
type ImportOptions = Readonly<{
  invitations: unknown;
  bindings: unknown;
  ownerEmail: string;
  now: () => Date;
  uuid: () => string;
  sha256: (value: string) => string;
}>;
type ImportData = Record<IdentityTable, string[][]>;
export const usersImportCheckpointSchema = z.strictObject({
  version: z.literal(1),
  state: z.enum(['prepared', 'applied']),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  baseRevision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  ids: z
    .array(z.uuid())
    .min(2)
    .max(21)
    .refine((ids) => new Set(ids).size === ids.length),
});
type Checkpoint = z.infer<typeof usersImportCheckpointSchema>;

function source(options: ImportOptions) {
  const invitesResult = invitationsSchema.safeParse(options.invitations);
  const bindingsResult = bindingsSchema.safeParse(options.bindings);
  if (!invitesResult.success || !bindingsResult.success)
    throw new UsersImportError('IMPORT_SOURCE_INVALID');
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const invitations = invitesResult.data.sort((a, b) => compare(a.email, b.email));
  const bindings = bindingsResult.data
    .map((binding) => ({ ...binding, email: binding.email.toLowerCase() }))
    .sort((a, b) => compare(a.email, b.email));
  if (new Set(bindings.map((binding) => binding.email)).size !== bindings.length)
    throw new UsersImportError('IMPORT_SOURCE_INVALID');
  const owners = invitations.filter((invite) => invite.role === 'owner');
  const owner = owners[0];
  if (
    owners.length !== 1 ||
    !owner ||
    owner.email !== options.ownerEmail.toLowerCase() ||
    !bindings.some((binding) => binding.email === owner.email)
  )
    throw new UsersImportError('IMPORT_OWNER_REQUIRED');
  return { invitations, bindings, ownerEmail: owner.email };
}
type Source = ReturnType<typeof source>;
function makeData(input: Source, createdAt: string, uuid: () => string): ImportData {
  const users = input.bindings.map((binding) => [
    uuid(),
    binding.sub,
    binding.email,
    binding.email,
    '',
    '',
    'active',
    binding.joinedAt,
    '',
    '1',
  ]);
  const userByEmail = new Map(users.map((user) => [user[3], user]));
  const ownerId = userByEmail.get(input.ownerEmail)?.[0];
  if (!ownerId) throw new UsersImportError('IMPORT_OWNER_REQUIRED');
  const workspaceId = uuid();
  const members: string[][] = [];
  const invites = input.invitations.map((invite) => {
    const user = userByEmail.get(invite.email);
    const userId = user?.[0] ?? '';
    const joinedAt = user?.[7] ?? '';
    if (user) members.push([workspaceId, userId, invite.role, 'active', joinedAt, '1']);
    return [
      uuid(),
      workspaceId,
      invite.email,
      invite.role,
      ownerId,
      invite.expiresAt,
      userId,
      joinedAt,
      user ? 'used' : Date.parse(invite.expiresAt) <= Date.parse(createdAt) ? 'expired' : 'pending',
    ];
  });
  return {
    Users: users,
    Workspaces: [
      [workspaceId, 'Моя кулинарная тетрадь', ownerId, '', '', createdAt, createdAt, '1'],
    ],
    WorkspaceMembers: members,
    Invites: invites,
  };
}
function metaRows(store: UsersImportStore) {
  const entries = store.read('Meta')?.rows ?? [];
  const map = new Map(entries.map((row) => [row[0], row]));
  if (map.size !== entries.length || entries.some((row) => row.length !== 3 || !row[0]))
    throw new UsersImportError('IMPORT_META_INVALID');
  if (map.get('schema_version')?.[1] !== '1' || map.get('maintenance_mode')?.[1] !== 'false')
    throw new UsersImportError('IMPORT_SCHEMA_REQUIRED');
  return map;
}
function rowKey(table: IdentityTable, row: readonly string[]) {
  return table === 'WorkspaceMembers' ? JSON.stringify(row.slice(0, 2)) : row[0];
}
function pendingRows(store: UsersImportStore, data: ImportData) {
  const pending: Record<IdentityTable, readonly string[][]> = {
    Users: [],
    Workspaces: [],
    WorkspaceMembers: [],
    Invites: [],
  };
  for (const table of IDENTITY_TABLES) {
    const expected = new Map(data[table].map((row) => [rowKey(table, row), row]));
    const actual = store.readIdentityRows(table);
    const seen = new Set<string | undefined>();
    for (const row of actual) {
      const key = rowKey(table, row);
      if (seen.has(key) || JSON.stringify(expected.get(key)) !== JSON.stringify(row))
        throw new UsersImportError('IMPORT_TARGET_CONFLICT', table);
      seen.add(key);
    }
    pending[table] = data[table].filter((row) => !seen.has(rowKey(table, row)));
  }
  return pending;
}
function prepare(store: UsersImportStore, options: ImportOptions) {
  const input = source(options);
  const sourceHash = options.sha256(JSON.stringify(input));
  const meta = metaRows(store);
  const revisionText = meta.get('data_revision')?.[1] ?? '';
  if (!/^(0|[1-9]\d*)$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText)))
    throw new UsersImportError('IMPORT_META_INVALID');
  const revision = Number(revisionText);
  const previous = meta.get(USERS_IMPORT_KEY)?.[1];
  let checkpoint: Checkpoint;
  let data: ImportData;
  if (previous !== undefined) {
    try {
      if (previous.length > 4096) throw new Error();
      checkpoint = usersImportCheckpointSchema.parse(JSON.parse(previous));
    } catch {
      throw new UsersImportError('IMPORT_CHECKPOINT_INVALID');
    }
    if (checkpoint.sourceHash !== sourceHash) throw new UsersImportError('IMPORT_SOURCE_CHANGED');
    let index = 0;
    data = makeData(input, checkpoint.createdAt, () => checkpoint.ids[index++] ?? '');
    if (index !== checkpoint.ids.length) throw new UsersImportError('IMPORT_CHECKPOINT_INVALID');
    if (revision !== checkpoint.baseRevision && revision !== checkpoint.baseRevision + 1)
      throw new UsersImportError('IMPORT_REVISION_CONFLICT');
    if (checkpoint.state === 'applied' && revision !== checkpoint.baseRevision + 1)
      throw new UsersImportError('IMPORT_REVISION_CONFLICT');
  } else {
    // Never adopt pre-existing records or regenerate IDs after a partially completed import.
    for (const table of IDENTITY_TABLES) {
      if (store.readIdentityRows(table).length)
        throw new UsersImportError('IMPORT_TARGET_NOT_EMPTY', table);
    }
    const ids: string[] = [];
    const createdAt = options.now().toISOString();
    data = makeData(input, createdAt, () => {
      const id = options.uuid();
      ids.push(id);
      return id;
    });
    const parsed = usersImportCheckpointSchema.safeParse({
      version: 1,
      state: 'prepared',
      sourceHash,
      createdAt,
      baseRevision: revision,
      ids,
    });
    if (!parsed.success) throw new UsersImportError('IMPORT_CONFIG_INVALID');
    checkpoint = parsed.data;
  }
  for (const table of IDENTITY_TABLES) {
    if (data[table].some((row) => row.some((value) => /^[=+\-@\t\r\n]/.test(value))))
      throw new UsersImportError('IMPORT_UNSAFE_VALUE', table);
  }
  const pending = pendingRows(store, data);
  const incomplete = IDENTITY_TABLES.some((table) => pending[table].length > 0);
  if ((checkpoint.state === 'applied' || revision === checkpoint.baseRevision + 1) && incomplete)
    throw new UsersImportError('IMPORT_TARGET_CONFLICT');
  return { checkpoint, data, pending, hasCheckpoint: previous !== undefined };
}
function report(prepared: ReturnType<typeof prepare>) {
  const { checkpoint, data, pending } = prepared;
  return {
    importId: USERS_IMPORT_KEY,
    alreadyApplied: checkpoint.state === 'applied',
    users: data.Users.length,
    workspaces: data.Workspaces.length,
    memberships: data.WorkspaceMembers.length,
    invitations: data.Invites.length,
    pendingRows: IDENTITY_TABLES.reduce((total, table) => total + pending[table].length, 0),
    roles: {
      owner: data.WorkspaceMembers.filter((row) => row[2] === 'owner').length,
      member: data.WorkspaceMembers.filter((row) => row[2] === 'member').length,
      viewer: data.WorkspaceMembers.filter((row) => row[2] === 'viewer').length,
    },
  };
}
export function planUsersImport(store: UsersImportStore, options: ImportOptions) {
  return report(prepare(store, options));
}
function writeMeta(store: UsersImportStore, key: string, value: string, timestamp: string) {
  const entries = store.read('Meta')?.rows ?? [];
  const index = entries.findIndex((row) => row[0] === key);
  store.writeRow('Meta', index < 0 ? entries.length + 2 : index + 2, [key, value, timestamp]);
}
export function applyUsersImport(store: UsersImportStore, options: ImportOptions) {
  const prepared = prepare(store, options);
  const { checkpoint, data, pending } = prepared;
  if (checkpoint.state === 'applied')
    return { ...report(prepared), result: 'already-applied' as const };
  try {
    if (!prepared.hasCheckpoint) {
      writeMeta(store, USERS_IMPORT_KEY, JSON.stringify(checkpoint), checkpoint.createdAt);
      store.flush();
    }
    for (const table of IDENTITY_TABLES) {
      let nextRow = store.readIdentityRows(table).length + 2;
      for (const row of pending[table]) store.writeRow(table, nextRow++, row);
    }
    store.flush();
    const remaining = pendingRows(store, data);
    if (IDENTITY_TABLES.some((table) => remaining[table].length))
      throw new UsersImportError('IMPORT_VERIFY_FAILED');
    writeMeta(
      store,
      'data_revision',
      String(checkpoint.baseRevision + 1),
      options.now().toISOString(),
    );
    store.flush();
    writeMeta(
      store,
      USERS_IMPORT_KEY,
      JSON.stringify({ ...checkpoint, state: 'applied' }),
      options.now().toISOString(),
    );
    store.flush();
    const verified = prepare(store, options);
    if (!verified.checkpoint || verified.checkpoint.state !== 'applied')
      throw new UsersImportError('IMPORT_VERIFY_FAILED');
    return { ...report(verified), result: 'applied' as const };
  } catch (error) {
    if (error instanceof UsersImportError) throw error;
    throw new UsersImportError('IMPORT_WRITE_FAILED');
  }
}
