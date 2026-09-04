import { z } from 'zod';
import { canonicalRecipeJson } from './recipe-storage';

export class BackupError extends Error {
  constructor(
    public readonly code:
      | 'BACKUP_UNAVAILABLE'
      | 'BACKUP_INVALID'
      | 'BACKUP_PENDING'
      | 'BACKUP_LIMIT' = 'BACKUP_UNAVAILABLE',
  ) {
    super(code);
  }
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const resourceId = z.string().regex(/^[\w-]{1,200}$/);
const tableSchema = z.strictObject({
  name: z.string().min(1).max(100),
  rows: z.array(z.array(z.string().max(50000)).max(100)).max(100001),
  hash,
});
const fileSchema = z.strictObject({
  id: resourceId,
  parentId: resourceId,
  name: z.string().min(1).max(255),
  mime: z.string().min(1),
  bytes: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
  hash,
});
export const backupPlanSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  workspaceId: z.uuid(),
  createdAt: z.iso.datetime(),
  sourceSpreadsheetId: resourceId,
  sourceFolderId: resourceId,
  properties: z.record(z.string(), z.string()),
  tables: z.array(tableSchema).min(14).max(50),
  folders: z
    .array(
      z.strictObject({ id: resourceId, parentId: resourceId, name: z.string().min(1).max(255) }),
    )
    .max(100),
  files: z.array(fileSchema).max(2000),
});
export type BackupPlan = z.infer<typeof backupPlanSchema>;
export type BackupFile = z.infer<typeof fileSchema>;
export type BackupSummary = {
  id: string;
  createdAt: string;
  tables: number;
  files: number;
  hash: string;
};
export type RestoredBook = { spreadsheetUrl: string; folderUrl: string; configurationUrl: string };
export type BackupPort = {
  sha256: (value: string) => string;
  assertAuthorized: () => void;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  capture: (id: string) => BackupPlan;
  copyFile: (id: string, file: BackupFile) => void;
  verifyFile: (id: string, file: BackupFile) => void;
  restore: (plan: BackupPlan, requestId: string) => RestoredBook;
};
export const backupKeys = {
  plan: (id: string) => `backup-${id}-plan.json`,
  ready: (id: string) => `backup-${id}-ready.json`,
  restored: (id: string) => `restore-${id}-ready.json`,
};
export function validateBackupPlan(input: unknown, sha256: (value: string) => string): BackupPlan {
  const plan = backupPlanSchema.parse(input);
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !unique(plan.tables.map((table) => table.name)) ||
    !unique([
      plan.sourceFolderId,
      ...plan.folders.map((folder) => folder.id),
      ...plan.files.map((file) => file.id),
    ]) ||
    !unique([...plan.folders, ...plan.files].map((item) => `${item.parentId}:${item.name}`))
  )
    throw new BackupError('BACKUP_INVALID');
  const parents = new Set([plan.sourceFolderId]);
  for (const folder of plan.folders) {
    if (!parents.has(folder.parentId)) throw new BackupError('BACKUP_INVALID');
    parents.add(folder.id);
  }
  if (
    plan.files.some(
      (file) => !parents.has(file.parentId) || file.mime.startsWith('application/vnd.google-apps.'),
    )
  )
    throw new BackupError('BACKUP_INVALID');
  if (plan.files.reduce((size, file) => size + file.bytes, 0) > 200 * 1024 * 1024)
    throw new BackupError('BACKUP_LIMIT');
  for (const table of plan.tables)
    if (
      sha256(canonicalRecipeJson(table.rows)) !== table.hash ||
      !table.rows.length ||
      table.rows.some(
        (row) => row.length !== table.rows[0]?.length || row.some((cell) => cell.startsWith('=')),
      )
    )
      throw new BackupError('BACKUP_INVALID');
  if (
    Object.keys(plan.properties).some(
      (key) =>
        ![
          'APP_ENV',
          'SHEETS_AUTH_CONFIG',
          'GOOGLE_CLIENT_IDS',
          'PRODUCTION_GOOGLE_CLIENT_IDS',
        ].includes(key) && !/^STAGING_PHOTO_[a-f0-9]{64}$/.test(key),
    )
  )
    throw new BackupError('BACKUP_INVALID');
  for (const [key, value] of Object.entries(plan.properties)) {
    if (!key.startsWith('STAGING_PHOTO_')) continue;
    const photo = JSON.parse(value) as {
      folderId: string;
      imageId: string;
      thumbnailId: string;
      imageDigest: string;
      thumbnailDigest: string;
    };
    if (
      photo.folderId !== plan.sourceFolderId ||
      !plan.files.some(
        (file) =>
          file.id === photo.imageId &&
          file.parentId === photo.folderId &&
          file.hash === photo.imageDigest,
      ) ||
      !plan.files.some(
        (file) =>
          file.id === photo.thumbnailId &&
          file.parentId === photo.folderId &&
          file.hash === photo.thumbnailDigest,
      )
    )
      throw new BackupError('BACKUP_INVALID');
  }
  return plan;
}
const summary = (plan: BackupPlan, digest: string): BackupSummary => ({
  id: plan.id,
  createdAt: plan.createdAt,
  tables: plan.tables.length,
  files: plan.files.length,
  hash: digest,
});
function loadPlan(port: BackupPort, id: string, workspaceId: string) {
  const raw = port.read(backupKeys.plan(id));
  if (!raw) throw new BackupError('BACKUP_INVALID');
  const plan = validateBackupPlan(JSON.parse(raw), port.sha256);
  if (plan.id !== id || plan.workspaceId !== workspaceId) throw new BackupError('BACKUP_INVALID');
  return { plan, hash: port.sha256(raw) };
}
export function verifyBookBackup(port: BackupPort, id: string, workspaceId: string) {
  port.assertAuthorized();
  const loaded = loadPlan(port, id, workspaceId);
  if (port.read(backupKeys.ready(id)) !== canonicalRecipeJson(summary(loaded.plan, loaded.hash)))
    throw new BackupError('BACKUP_INVALID');
  for (const file of loaded.plan.files) {
    port.assertAuthorized();
    port.verifyFile(id, file);
  }
  port.assertAuthorized();
  return summary(loaded.plan, loaded.hash);
}
export function createBookBackup(port: BackupPort, id: string, workspaceId: string) {
  port.assertAuthorized();
  z.uuid().parse(id);
  if (port.read(backupKeys.ready(id))) return verifyBookBackup(port, id, workspaceId);
  if (!port.read(backupKeys.plan(id))) {
    const plan = validateBackupPlan(port.capture(id), port.sha256);
    if (plan.workspaceId !== workspaceId || plan.id !== id) throw new BackupError('BACKUP_INVALID');
    port.assertAuthorized();
    port.write(backupKeys.plan(id), canonicalRecipeJson(plan));
  }
  const loaded = loadPlan(port, id, workspaceId);
  for (const file of loaded.plan.files) {
    port.assertAuthorized();
    port.copyFile(id, file);
    port.verifyFile(id, file);
  }
  port.assertAuthorized();
  port.write(backupKeys.ready(id), canonicalRecipeJson(summary(loaded.plan, loaded.hash)));
  return verifyBookBackup(port, id, workspaceId);
}
export function restoreBookBackup(
  port: BackupPort,
  id: string,
  workspaceId: string,
  requestId: string,
) {
  z.uuid().parse(requestId);
  const backup = verifyBookBackup(port, id, workspaceId);
  const previous = port.read(backupKeys.restored(requestId));
  if (previous) {
    const parsed = JSON.parse(previous) as { backupId: string; result: RestoredBook };
    if (parsed.backupId !== id) throw new BackupError('BACKUP_INVALID');
    // The adapter re-verifies the same restored resources; a lost response never creates a new book.
  }
  const loaded = loadPlan(port, id, workspaceId);
  const binding = `restore-${requestId}-binding.json`;
  port.write(binding, canonicalRecipeJson({ backupId: id, hash: loaded.hash }));
  const result = port.restore(loaded.plan, requestId);
  port.assertAuthorized();
  port.write(backupKeys.restored(requestId), canonicalRecipeJson({ backupId: id, result }));
  return { backup, ...result };
}
