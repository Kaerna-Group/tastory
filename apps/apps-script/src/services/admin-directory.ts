import type { AdminUsersData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import type { WorkspaceDirectory } from '../auth/workspace-access';
import { resolveWorkspaceAccess } from '../auth/workspace-access';

export class AdminError extends Error {
  readonly code = 'ADMIN_UNAVAILABLE';
  constructor() {
    super('ADMIN_UNAVAILABLE');
  }
}

export function listWorkspaceUsers(
  directory: WorkspaceDirectory,
  subject: string,
  workspaceId: string,
  checkedAt: string,
): AdminUsersData {
  const access = resolveWorkspaceAccess(directory, subject, workspaceId);
  if (access.role !== 'owner') throw new AuthError('ACCESS_DENIED');
  const workspace = directory.workspaces.find((item) => item.workspace_id === workspaceId);
  if (!workspace) throw new AdminError();
  const rank = { owner: 0, member: 1, viewer: 2 };
  const users = directory.members
    .filter((member) => member.workspace_id === workspaceId)
    .map((member) => {
      const user = directory.users.find((candidate) => candidate.user_id === member.user_id);
      if (!user) throw new AdminError();
      return {
        id: user.user_id,
        email: user.email,
        displayName: user.display_name,
        role: member.role,
        userStatus: user.status,
        membershipStatus: member.status,
        joinedAt: member.joined_at,
      };
    })
    .sort((a, b) => rank[a.role] - rank[b.role] || a.email.localeCompare(b.email));
  return { workspace: { id: workspaceId, name: workspace.name }, checkedAt, users };
}
