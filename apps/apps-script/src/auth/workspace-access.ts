import { z } from 'zod';
import { AuthError } from './google-token';

const id = z.uuid();
const date = z.iso.datetime();
const optionalDate = z.union([date, z.literal('')]);
const revision = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
export const sheetsAuthConfigSchema = z.strictObject({
  version: z.literal(1),
  backend: z.literal('sheets'),
  workspaceId: id,
});
const userSchema = z
  .strictObject({
    user_id: id,
    google_sub: z.string().min(1).max(255),
    email: z.email().max(254),
    email_normalized: z.email().max(254),
    display_name: z.string().max(200),
    avatar_asset_id: z.union([id, z.literal('')]),
    status: z.enum(['active', 'disabled', 'pending']),
    created_at: date,
    last_login_at: optionalDate,
    row_revision: revision,
  })
  .refine((user) => user.email_normalized === user.email_normalized.toLowerCase());
const workspaceSchema = z.strictObject({
  workspace_id: id,
  name: z.string().min(1).max(200),
  owner_user_id: id,
  default_app_theme_id: z.union([id, z.literal('')]),
  default_canvas_theme_id: z.union([id, z.literal('')]),
  created_at: date,
  updated_at: date,
  row_revision: revision,
});
const memberSchema = z.strictObject({
  workspace_id: id,
  user_id: id,
  role: z.enum(['owner', 'member', 'viewer']),
  status: z.enum(['active', 'disabled']),
  joined_at: date,
  row_revision: revision,
});
const directorySchema = z.strictObject({
  users: z.array(userSchema).max(10),
  workspaces: z.array(workspaceSchema).max(10),
  members: z.array(memberSchema).max(100),
});
export type WorkspaceDirectory = z.infer<typeof directorySchema>;
export type SheetsAuthConfig = z.infer<typeof sheetsAuthConfigSchema>;

export function parseWorkspaceDirectory(input: unknown): WorkspaceDirectory {
  const parsed = directorySchema.safeParse(input);
  if (!parsed.success) throw new AuthError('AUTH_UNAVAILABLE');
  const directory = parsed.data;
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !unique(directory.users.map((u) => u.user_id)) ||
    !unique(directory.users.map((u) => u.google_sub)) ||
    !unique(directory.users.map((u) => u.email_normalized)) ||
    !unique(directory.workspaces.map((w) => w.workspace_id)) ||
    !unique(directory.members.map((m) => `${m.workspace_id}:${m.user_id}`))
  )
    throw new AuthError('AUTH_UNAVAILABLE');
  const users = new Set(directory.users.map((u) => u.user_id));
  const workspaces = new Set(directory.workspaces.map((w) => w.workspace_id));
  if (directory.members.some((m) => !users.has(m.user_id) || !workspaces.has(m.workspace_id)))
    throw new AuthError('AUTH_UNAVAILABLE');
  for (const workspace of directory.workspaces) {
    const owners = directory.members.filter(
      (m) => m.workspace_id === workspace.workspace_id && m.role === 'owner',
    );
    if (
      !users.has(workspace.owner_user_id) ||
      owners.length !== 1 ||
      owners[0]?.user_id !== workspace.owner_user_id
    )
      throw new AuthError('AUTH_UNAVAILABLE');
  }
  return directory;
}

// All inputs come from verified Google claims and server-read rows, never from a requested role.
export function resolveWorkspaceAccess(
  directory: WorkspaceDirectory,
  subject: string,
  workspaceId: string,
) {
  const user = directory.users.find((candidate) => candidate.google_sub === subject);
  const workspace = directory.workspaces.find(
    (candidate) => candidate.workspace_id === workspaceId,
  );
  if (!user || user.status !== 'active' || !workspace) throw new AuthError('ACCESS_DENIED');
  const membership = directory.members.find(
    (candidate) => candidate.user_id === user.user_id && candidate.workspace_id === workspaceId,
  );
  if (!membership || membership.status !== 'active') throw new AuthError('ACCESS_DENIED');
  return { userId: user.user_id, workspaceId, role: membership.role };
}
