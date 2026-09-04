import { z } from 'zod';
import { backupRoot, createBackupPort } from '../platform/backup-drive';
import { privateResourceFolder } from '../platform/private-resources';
import {
  backupKeys,
  BackupError,
  restoreBookBackup,
  validateBackupPlan,
} from '../services/book-backup';
import { sha256 } from '../platform/current-schema';

// Operator-only editor entrypoint, deliberately absent from the HTTP allowlist.
// Recovery must work even if the original spreadsheet and its identity tables no longer exist.
export function recoverBookBackup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new BackupError();
  try {
    const properties = PropertiesService.getScriptProperties();
    const id = z.uuid().parse(properties.getProperty('BACKUP_RECOVERY_ID'));
    const root = backupRoot(properties, properties.getProperty('DRIVE_FOLDER_ID') ?? '', false);
    if (!root) throw new BackupError('BACKUP_INVALID');
    const assertAuthorized = () => {
      privateResourceFolder(root.getId());
    };
    assertAuthorized();
    let requestId = properties.getProperty('BACKUP_RECOVERY_REQUEST_ID');
    if (!requestId) {
      requestId = Utilities.getUuid();
      properties.setProperty('BACKUP_RECOVERY_REQUEST_ID', requestId);
    }
    z.uuid().parse(requestId);
    const base = { root, sourceFolderId: '', workspaceId: '', properties, assertAuthorized };
    const port = createBackupPort(base);
    const plan = validateBackupPlan(JSON.parse(port.read(backupKeys.plan(id)) ?? 'null'), sha256);
    return restoreBookBackup(port, id, plan.workspaceId, requestId);
  } finally {
    lock.releaseLock();
  }
}
