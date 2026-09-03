import { z } from 'zod';
import { CORE_TABLES } from '../schema/core-schema';

export class AccessError extends Error {
  constructor(
    public readonly code:
      | 'ACCESS_CONFLICT'
      | 'ACCESS_PENDING'
      | 'ACCESS_LIMIT'
      | 'ACCESS_INVALID'
      | 'ACCESS_UNAVAILABLE' = 'ACCESS_UNAVAILABLE',
  ) {
    super(code);
  }
}
export const accessActions = [
  'admin.invites.create',
  'admin.invites.revoke',
  'admin.members.update',
  'auth.invite.accept',
] as const;
export const inviteSchema = z
  .strictObject({
    invite_id: z.uuid(),
    workspace_id: z.uuid(),
    email_normalized: z.email().max(254),
    role: z.enum(['owner', 'member', 'viewer']),
    invited_by: z.uuid(),
    expires_at: z.iso.datetime(),
    used_by: z.union([z.uuid(), z.literal('')]),
    used_at: z.union([z.iso.datetime(), z.literal('')]),
    status: z.enum(['pending', 'used', 'expired', 'revoked']),
  })
  .refine(
    (i) =>
      i.email_normalized === i.email_normalized.toLowerCase() &&
      (i.status === 'used'
        ? i.used_by !== '' && i.used_at !== ''
        : i.used_by === '' && i.used_at === ''),
  );
export type Invite = z.infer<typeof inviteSchema>;
const row = z
  .array(
    z
      .string()
      .max(4096)
      .refine((v) => !/^[=+\-@\t\r\n]/.test(v)),
  )
  .max(10);
const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const accessPlanSchema = z
  .strictObject({
    kind: z.literal('access-write'),
    version: z.literal(1),
    fromRevision: revision,
    toRevision: revision,
    entityId: z.uuid(),
    writes: z
      .array(
        z
          .strictObject({
            table: z.enum(['Users', 'WorkspaceMembers', 'Invites', 'Meta']),
            row: z.number().int().min(2).max(1001),
            before: row.nullable(),
            after: row,
          })
          .refine((w) => {
            const width = CORE_TABLES.find((t) => t.name === w.table)?.columns.length;
            return (
              w.after.length === width &&
              (w.before === null || w.before.length === width) &&
              (w.table !== 'Meta' ||
                (w.before?.[0] === 'data_revision' && w.after[0] === 'data_revision'))
            );
          }),
      )
      .min(2)
      .max(4),
  })
  .refine(
    (p) =>
      p.toRevision === p.fromRevision + 1 &&
      p.writes[p.writes.length - 1]?.table === 'Meta' &&
      p.writes.filter((w) => w.table === 'Meta').length === 1 &&
      p.writes[p.writes.length - 1]?.before?.[1] === String(p.fromRevision) &&
      p.writes[p.writes.length - 1]?.after[1] === String(p.toRevision) &&
      new Set(p.writes.map((w) => `${w.table}:${w.row}`)).size === p.writes.length,
  );
export type AccessPlan = z.infer<typeof accessPlanSchema>;
export function parseAccessPlan(json: string): AccessPlan {
  try {
    return accessPlanSchema.parse(JSON.parse(json));
  } catch {
    throw new AccessError();
  }
}
