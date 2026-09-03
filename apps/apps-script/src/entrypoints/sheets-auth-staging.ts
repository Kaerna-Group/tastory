import { bindingsSchema, invitationsSchema } from '../auth/invitations';
import { sheetsAuthConfigSchema, resolveWorkspaceAccess } from '../auth/workspace-access';
import { AuthError } from '../auth/google-token';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from '../platform/workspace-directory';
import { createUsersImportStore } from '../platform/users-import-store';
import { planUsersImport, UsersImportError } from '../services/users-import';
import { planCoreSchema, SchemaMigrationError } from '../services/core-migration';
import { CORE_SCHEMA_FINGERPRINT } from '../schema/core-schema';

// Owner-only editor function. Validates the exact import before atomically selecting Sheets.
export function activateStagingSheetsAuth() {
  let lock: GoogleAppsScript.Lock.Lock | undefined;
  let locked = false;
  try {
    lock = LockService.getScriptLock();
    locked = lock.tryLock(10000);
    if (!locked) throw new AuthError('AUTH_UNAVAILABLE');
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('APP_ENV') !== 'staging') throw new AuthError('AUTH_NOT_CONFIGURED');
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const driveRootId = properties.getProperty('DRIVE_FOLDER_ID');
    if (!spreadsheetId || !driveRootId) throw new AuthError('AUTH_NOT_CONFIGURED');
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const directory = readWorkspaceDirectory(spreadsheet);
    const ownerEmail = Session.getEffectiveUser().getEmail().toLowerCase();
    const owner = directory.users.find((user) => user.email_normalized === ownerEmail);
    if (!owner || !ownerEmail) throw new AuthError('ACCESS_DENIED');
    const previous = properties.getProperty(SHEETS_AUTH_CONFIG_KEY);
    let config;
    if (previous !== null) {
      config = sheetsAuthConfigSchema.parse(JSON.parse(previous));
    } else {
      if (directory.workspaces.length !== 1) throw new AuthError('AUTH_UNAVAILABLE');
      const workspace = directory.workspaces[0];
      if (!workspace) throw new AuthError('AUTH_UNAVAILABLE');
      config = sheetsAuthConfigSchema.parse({
        version: 1,
        backend: 'sheets',
        workspaceId: workspace.workspace_id,
      });
    }
    if (resolveWorkspaceAccess(directory, owner.google_sub, config.workspaceId).role !== 'owner')
      throw new AuthError('ACCESS_DENIED');
    if (previous === null) {
      const sha256 = (value: string) =>
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
          .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
          .join('');
      const store = createUsersImportStore(spreadsheet);
      if (
        !planCoreSchema(store, {
          checksum: sha256(CORE_SCHEMA_FINGERPRINT),
          driveRootId,
          now: () => new Date(),
        }).alreadyApplied
      )
        throw new AuthError('AUTH_UNAVAILABLE');
      const invitations = invitationsSchema.parse(
        JSON.parse(properties.getProperty('STAGING_INVITES') ?? 'null'),
      );
      const bindings = bindingsSchema.parse(
        JSON.parse(properties.getProperty('STAGING_AUTH_BINDINGS') ?? 'null'),
      );
      if (
        !planUsersImport(store, {
          invitations,
          bindings,
          ownerEmail,
          sha256,
          now: () => new Date(),
          uuid: () => Utilities.getUuid(),
        }).alreadyApplied
      )
        throw new AuthError('AUTH_UNAVAILABLE');
      // New invitation acceptance belongs to the next transactional user-management slice.
      // Do not switch while a live legacy invitation still needs to be consumed.
      if (
        invitations.some(
          (invite) =>
            Date.parse(invite.expiresAt) > Date.now() &&
            !bindings.some((binding) => binding.email.toLowerCase() === invite.email),
        )
      )
        throw new UsersImportError('PENDING_INVITATIONS');
      const serialized = JSON.stringify(config);
      properties.setProperty(SHEETS_AUTH_CONFIG_KEY, serialized);
      if (properties.getProperty(SHEETS_AUTH_CONFIG_KEY) !== serialized)
        throw new AuthError('AUTH_UNAVAILABLE');
    }
    const report = {
      ok: true,
      result: previous === null ? 'enabled' : 'already-enabled',
      backend: 'sheets',
      users: directory.users.length,
      memberships: directory.members.filter(
        (member) => member.workspace_id === config.workspaceId && member.status === 'active',
      ).length,
    };
    console.info(JSON.stringify(report));
    return report;
  } catch (error) {
    const code =
      error instanceof AuthError ||
      error instanceof UsersImportError ||
      error instanceof SchemaMigrationError
        ? error.code
        : 'AUTH_UNAVAILABLE';
    const report = { ok: false, code };
    console.info(JSON.stringify(report));
    return report;
  } finally {
    if (locked) lock?.releaseLock();
  }
}
