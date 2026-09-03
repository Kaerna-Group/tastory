import type { AccessCommand, AccessData, AuthData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { resolveWorkspaceAccess, sheetsAuthConfigSchema } from '../auth/workspace-access';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { createAccessStore } from './access-store';
import { journalMigrationOptions, sha256 } from './current-schema';
import { planJournalSchema } from '../services/journal-migration';
import { readJournal } from '../services/operation-journal';
import {
  accessInvites,
  accessRevision,
  mutateAccess,
  pendingAccess,
  resumeAccess,
} from '../services/access-mutations';
import { AccessError } from '../services/access-model';
import { JournalError } from '../services/journal-error';

export function manageAccess(
  command: AccessCommand,
  requestId: string,
  session: AuthData,
): AccessData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new AccessError();
  try {
    const assertLive = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    assertLive();
    const props = PropertiesService.getScriptProperties();
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(props.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');
    if (props.getProperty('APP_ENV') !== 'staging' || !spreadsheetId || !config.success)
      throw new AccessError();
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const directory = readWorkspaceDirectory(spreadsheet);
    const actor = resolveWorkspaceAccess(directory, session.user.id, config.data.workspaceId);
    if (actor.role !== 'owner') throw new AuthError('ACCESS_DENIED');
    const store = createAccessStore(spreadsheet);
    if (
      !planJournalSchema(
        store.journal,
        journalMigrationOptions(props.getProperty('DRIVE_FOLDER_ID') ?? ''),
      ).alreadyApplied
    )
      throw new JournalError('JOURNAL_NOT_READY');
    const options = { now: () => new Date(), uuid: () => Utilities.getUuid(), sha256, assertLive };
    if (command.action === 'admin.access.list') {
      const invites = accessInvites(store).filter((i) => i.workspace_id === actor.workspaceId);
      const pending = pendingAccess(store)
        .filter((op) => op.workspace_id === actor.workspaceId)
        .map((op) => ({
          id: op.request_id,
          action: op.action as
            | 'admin.invites.create'
            | 'admin.invites.revoke'
            | 'admin.members.update'
            | 'auth.invite.accept',
          canResume: op.user_id === actor.userId || op.action === 'auth.invite.accept',
        }));
      const members = directory.members
        .filter((m) => m.workspace_id === actor.workspaceId)
        .map((m) => {
          const user = directory.users.find((u) => u.user_id === m.user_id);
          if (!user) throw new AccessError();
          return {
            id: m.user_id,
            name: user.display_name || user.email,
            email: user.email,
            role: m.role,
            status: m.status,
            accountActive: user.status === 'active',
          };
        });
      assertLive();
      return {
        kind: 'access',
        revision: accessRevision(store),
        checkedAt: new Date().toISOString(),
        members,
        invites: invites.map((i) => ({
          id: i.invite_id,
          email: i.email_normalized,
          role: i.role,
          status:
            i.status === 'pending' && Date.parse(i.expires_at) <= Date.now() ? 'expired' : i.status,
          expiresAt: i.expires_at,
        })),
        pending,
      };
    }
    if (command.action === 'admin.access.resume') {
      const op = readJournal(store.journal).operations.find(
        (o) => o.request_id === command.payload.operationId,
      );
      if (
        !op ||
        op.workspace_id !== actor.workspaceId ||
        op.action === 'admin.operations.check' ||
        (op.user_id !== actor.userId && op.action !== 'auth.invite.accept')
      )
        throw new AuthError('ACCESS_DENIED');
      return resumeAccess(store, op, options);
    }
    const result = mutateAccess(store, command, requestId, actor, options);
    assertLive();
    return result;
  } catch (error) {
    if (error instanceof AuthError || error instanceof AccessError || error instanceof JournalError)
      throw error;
    throw new AccessError();
  } finally {
    lock.releaseLock();
  }
}
