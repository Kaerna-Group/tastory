import { z } from 'zod';

export const journalEntrySchema = z
  .strictObject({
    id: z.uuid(),
    action: z.enum([
      'admin.operations.check',
      'admin.invites.create',
      'admin.invites.revoke',
      'admin.members.update',
      'auth.invite.accept',
    ]),
    actorName: z.string().min(1).max(254),
    status: z.enum(['started', 'committed']),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    auditRecorded: z.boolean(),
    canRetry: z.boolean(),
  })
  .refine((entry) =>
    entry.status === 'started'
      ? entry.completedAt === null
      : entry.completedAt !== null && entry.auditRecorded && !entry.canRetry,
  );
export const journalDataSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('list'),
      ready: z.boolean(),
      schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      checkedAt: z.iso.datetime(),
      total: z.number().int().min(0).max(1000),
      entries: z.array(journalEntrySchema).max(50),
    })
    .refine(
      (data) =>
        data.total >= data.entries.length &&
        (data.ready
          ? data.schemaVersion >= 2
          : data.schemaVersion === 1 && data.total === 0 && data.entries.length === 0),
    ),
  z.strictObject({
    kind: z.literal('initialized'),
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    alreadyApplied: z.boolean(),
  }),
  z
    .strictObject({
      kind: z.literal('check'),
      outcome: z.enum(['committed', 'replayed']),
      entry: journalEntrySchema,
      result: z.strictObject({ kind: z.literal('journal-check'), verified: z.literal(true) }),
    })
    .refine((data) => data.entry.status === 'committed'),
]);
export type JournalData = z.infer<typeof journalDataSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalAction =
  'admin.operations.list' | 'admin.operations.initialize' | 'admin.operations.check';
