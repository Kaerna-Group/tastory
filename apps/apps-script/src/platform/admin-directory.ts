import type { AdminAction, AdminHealthData, AdminUsersData, AuthData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { sheetsAuthConfigSchema } from '../auth/workspace-access';
import { AdminError, listWorkspaceUsers } from '../services/admin-directory';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { inspectCurrentSchema } from './current-schema';
import { runtimeEnvironment } from './runtime-environment';

export function readAdminDirectory(
  action: AdminAction,
  session: AuthData,
): AdminUsersData | AdminHealthData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new AdminError();
  try {
    const checkExpiry = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    checkExpiry();
    const properties = PropertiesService.getScriptProperties();
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(properties.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    if (!runtimeEnvironment(properties.getProperty('APP_ENV')) || !spreadsheetId || !config.success)
      throw new AdminError();
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const directory = readWorkspaceDirectory(spreadsheet);
    // Reauthorize under this lock: the role may have changed since JWT authentication.
    // Never use the client's email or the earlier session role to choose the owner/workspace.
    const users = listWorkspaceUsers(
      directory,
      session.user.id,
      config.data.workspaceId,
      new Date().toISOString(),
    );
    if (action === 'admin.users.list') {
      checkExpiry();
      return users;
    }
    const schema = inspectCurrentSchema(
      spreadsheet,
      properties.getProperty('DRIVE_FOLDER_ID') ?? '',
    );
    checkExpiry();
    return {
      workspace: users.workspace,
      checkedAt: new Date().toISOString(),
      status: 'ok',
      ...schema,
      members: users.users.length,
      activeMembers: users.users.filter(
        (user) => user.userStatus === 'active' && user.membershipStatus === 'active',
      ).length,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof AdminError) throw error;
    throw new AdminError();
  } finally {
    lock.releaseLock();
  }
}
