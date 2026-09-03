import { z } from 'zod';

const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const accessRoleSchema = z.enum(['member', 'viewer']);
export const accessWriteSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('admin.invites.create'),
    payload: z.strictObject({
      email: z.email().max(254),
      role: accessRoleSchema,
      days: z.number().int().min(1).max(30),
      expectedRevision: revision,
    }),
  }),
  z.strictObject({
    action: z.literal('admin.invites.revoke'),
    payload: z.strictObject({ inviteId: z.uuid(), expectedRevision: revision }),
  }),
  z.strictObject({
    action: z.literal('admin.members.update'),
    payload: z.strictObject({
      userId: z.uuid(),
      role: accessRoleSchema,
      status: z.enum(['active', 'disabled']),
      expectedRevision: revision,
    }),
  }),
]);
export const accessCommandSchema = z.discriminatedUnion('action', [
  ...accessWriteSchema.options,
  z.strictObject({ action: z.literal('admin.access.list'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('admin.access.resume'),
    payload: z.strictObject({ operationId: z.uuid() }),
  }),
]);
export const accessDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('access'),
    revision,
    checkedAt: z.iso.datetime(),
    members: z
      .array(
        z.strictObject({
          id: z.uuid(),
          name: z.string().min(1).max(254),
          email: z.email().max(254),
          role: z.enum(['owner', 'member', 'viewer']),
          status: z.enum(['active', 'disabled']),
          accountActive: z.boolean(),
        }),
      )
      .min(1)
      .max(10),
    invites: z
      .array(
        z.strictObject({
          id: z.uuid(),
          email: z.email().max(254),
          role: z.enum(['owner', 'member', 'viewer']),
          status: z.enum(['pending', 'used', 'expired', 'revoked']),
          expiresAt: z.iso.datetime(),
        }),
      )
      .max(100),
    pending: z
      .array(
        z.strictObject({
          id: z.uuid(),
          action: z.enum([
            'admin.invites.create',
            'admin.invites.revoke',
            'admin.members.update',
            'auth.invite.accept',
          ]),
          canResume: z.boolean(),
        }),
      )
      .max(1),
  }),
  z.strictObject({
    kind: z.literal('saved'),
    outcome: z.enum(['committed', 'replayed']),
    operationId: z.uuid(),
    entityId: z.uuid(),
    revision,
  }),
]);
export type AccessCommand = z.infer<typeof accessCommandSchema>;
export type AccessWrite = z.infer<typeof accessWriteSchema>;
export type AccessData = z.infer<typeof accessDataSchema>;
