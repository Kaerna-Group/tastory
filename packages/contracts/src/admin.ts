import { z } from 'zod';

const workspace = z.strictObject({ id: z.uuid(), name: z.string().min(1).max(200) });
export const adminUsersDataSchema = z
  .strictObject({
    workspace,
    checkedAt: z.iso.datetime(),
    users: z
      .array(
        z.strictObject({
          id: z.uuid(),
          email: z.email().max(254),
          displayName: z.string().max(200),
          role: z.enum(['owner', 'member', 'viewer']),
          userStatus: z.enum(['active', 'disabled', 'pending']),
          membershipStatus: z.enum(['active', 'disabled']),
          joinedAt: z.iso.datetime(),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine((data) => new Set(data.users.map((user) => user.id)).size === data.users.length);

export const adminHealthDataSchema = z
  .strictObject({
    workspace,
    checkedAt: z.iso.datetime(),
    status: z.literal('ok'),
    schemaVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
    ]),
    tablesChecked: z.union([
      z.literal(6),
      z.literal(8),
      z.literal(14),
      z.literal(15),
      z.literal(16),
      z.literal(17),
      z.literal(21),
    ]),
    members: z.number().int().min(1).max(10),
    activeMembers: z.number().int().min(1).max(10),
  })
  .refine(
    (data) =>
      data.activeMembers <= data.members &&
      data.tablesChecked === { 1: 6, 2: 8, 3: 14, 4: 15, 5: 16, 6: 17, 7: 21 }[data.schemaVersion],
  );

export type AdminUsersData = z.infer<typeof adminUsersDataSchema>;
export type AdminHealthData = z.infer<typeof adminHealthDataSchema>;
export type AdminAction = 'admin.users.list' | 'admin.health';
