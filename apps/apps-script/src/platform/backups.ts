import { backupCommandSchema, backupSummarySchema } from '@tastory/contracts';
import type { BackupCommand, BackupData, AuthData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { sheetsAuthConfigSchema, resolveWorkspaceAccess } from '../auth/workspace-access';
import { readWorkspaceDirectory } from './workspace-directory';
import { backupRoot, createBackupPort } from './backup-drive';
import {
  BackupError,
  createBookBackup,
  verifyBookBackup,
  restoreBookBackup,
  backupKeys,
} from '../services/book-backup';
import { fileInFolder } from './private-resources';
import { runtimeEnvironment } from './runtime-environment';

export function backups(input: BackupCommand, requestId: string, session: AuthData): BackupData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new BackupError();
  try {
    const command = backupCommandSchema.parse(input);
    const properties = PropertiesService.getScriptProperties();
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID'),
      folderId = properties.getProperty('DRIVE_FOLDER_ID');
    const config = sheetsAuthConfigSchema.parse(
      JSON.parse(properties.getProperty('SHEETS_AUTH_CONFIG') ?? 'null'),
    );
    if (!runtimeEnvironment(properties.getProperty('APP_ENV')) || !spreadsheetId || !folderId)
      throw new BackupError();
    const book = SpreadsheetApp.openById(spreadsheetId);
    const assertAuthorized = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
      const actor = resolveWorkspaceAccess(
        readWorkspaceDirectory(book),
        session.user.id,
        config.workspaceId,
      );
      if (actor.role !== 'owner') throw new AuthError('ACCESS_DENIED');
    };
    assertAuthorized();
    const root = backupRoot(properties, folderId, command.action === 'admin.backups.create');
    if (!root) {
      if (command.action === 'admin.backups.list')
        return { kind: 'backups', backups: [], incomplete: [] };
      throw new BackupError('BACKUP_INVALID');
    }
    const port = createBackupPort({
      root,
      book,
      sourceFolderId: folderId,
      workspaceId: config.workspaceId,
      properties,
      assertAuthorized,
    });
    if (command.action === 'admin.backups.list') {
      const files = root.getFiles(),
        complete = [],
        incomplete: string[] = [];
      while (files.hasNext()) {
        const file = files.next();
        const match = /^backup-([a-f0-9-]{36})-plan\.json$/.exec(file.getName());
        if (!match?.[1]) continue;
        fileInFolder(file, root.getId());
        const ready = port.read(backupKeys.ready(match[1]));
        if (ready) {
          const summary = backupSummarySchema.parse(JSON.parse(ready));
          if (summary.id !== match[1]) throw new BackupError('BACKUP_INVALID');
          complete.push(summary);
        } else incomplete.push(match[1]);
      }
      assertAuthorized();
      return {
        kind: 'backups',
        backups: complete.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
        incomplete: incomplete.slice(0, 100),
      };
    }
    const result: BackupData =
      command.action === 'admin.backups.create'
        ? { kind: 'backup', backup: createBookBackup(port, requestId, config.workspaceId) }
        : command.action === 'admin.backups.verify'
          ? {
              kind: 'backup',
              backup: verifyBookBackup(port, command.payload.backupId, config.workspaceId),
            }
          : {
              kind: 'restored',
              ...restoreBookBackup(port, command.payload.backupId, config.workspaceId, requestId),
            };
    assertAuthorized();
    return result;
  } catch (error) {
    if (error instanceof AuthError || error instanceof BackupError) throw error;
    throw new BackupError();
  } finally {
    lock.releaseLock();
  }
}
