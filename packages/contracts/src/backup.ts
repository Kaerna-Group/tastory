import { z } from 'zod';
const backupId = z.strictObject({ backupId: z.uuid() });
export const backupCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('admin.backups.list'), payload: z.strictObject({}) }),
  z.strictObject({ action: z.literal('admin.backups.create'), payload: z.strictObject({}) }),
  z.strictObject({ action: z.literal('admin.backups.verify'), payload: backupId }),
  z.strictObject({ action: z.literal('admin.backups.restore'), payload: backupId }),
]);
export const backupSummarySchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  tables: z.number().int().positive(),
  files: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const googleUrl = z.string().regex(/^https:\/\/(?:drive|docs)\.google\.com\/[\w/?=&#.%+-]+$/);
export const backupDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('backups'),
    backups: z.array(backupSummarySchema).max(100),
    incomplete: z.array(z.uuid()).max(100),
  }),
  z.strictObject({ kind: z.literal('backup'), backup: backupSummarySchema }),
  z.strictObject({
    kind: z.literal('restored'),
    backup: backupSummarySchema,
    spreadsheetUrl: googleUrl,
    folderUrl: googleUrl,
    configurationUrl: googleUrl,
  }),
]);
export type BackupCommand = z.infer<typeof backupCommandSchema>;
export type BackupData = z.infer<typeof backupDataSchema>;
