import { z } from 'zod';

export const concurrencyReadSchema = z.strictObject({ runId: z.uuid() });
export const concurrencyWriteSchema = z.strictObject({
  runId: z.uuid(),
  operationId: z.uuid(),
  expectedRevision: z.number().int().min(0).max(1),
  value: z.enum(['first', 'second']),
});
export const concurrencyStateSchema = z.strictObject({
  runId: z.uuid(),
  revision: z.number().int().min(0).max(2),
  value: z.enum(['first', 'second']).nullable(),
});
export const concurrencyDataSchema = z.strictObject({
  outcome: z.enum(['read', 'applied', 'replayed', 'conflict']),
  state: concurrencyStateSchema,
  appliedOperations: z.number().int().min(0).max(2),
  operationRevision: z.number().int().min(1).max(2).nullable(),
});
export type ConcurrencyData = z.infer<typeof concurrencyDataSchema>;
export type ConcurrencyWrite = z.infer<typeof concurrencyWriteSchema>;
export type ConcurrencyCommand =
  | { action: 'spike.concurrency.read'; payload: z.infer<typeof concurrencyReadSchema> }
  | { action: 'spike.concurrency.write'; payload: ConcurrencyWrite };
