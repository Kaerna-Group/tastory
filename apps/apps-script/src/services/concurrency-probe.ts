import { z } from 'zod';
import { concurrencyStateSchema, concurrencyWriteSchema } from '@tastory/contracts';
import type { ConcurrencyCommand, ConcurrencyData } from '@tastory/contracts';

export class ProbeError extends Error {
  constructor(public readonly code: 'PROBE_UNAVAILABLE' | 'PROBE_LIMIT' | 'OPERATION_MISMATCH') {
    super(code);
  }
}
export const probeRecordSchema = z
  .strictObject({
    version: z.literal(1),
    ownerKey: z.string().regex(/^[a-f0-9]{64}$/),
    state: concurrencyStateSchema,
    receipts: z.array(concurrencyWriteSchema.omit({ runId: true })).max(2),
  })
  .refine(
    ({ state, receipts }) =>
      state.revision === receipts.length &&
      state.value === (receipts[receipts.length - 1]?.value ?? null) &&
      receipts.every((receipt, i) => receipt.expectedRevision === i) &&
      new Set(receipts.map((receipt) => receipt.operationId)).size === receipts.length,
  );
export type ProbeRecord = z.infer<typeof probeRecordSchema>;
export function initialProbe(ownerKey: string, runId: string): ProbeRecord {
  return { version: 1, ownerKey, state: { runId, revision: 0, value: null }, receipts: [] };
}
export function applyProbe(
  record: ProbeRecord,
  command: ConcurrencyCommand,
): { record: ProbeRecord; data: ConcurrencyData; changed: boolean } {
  const data: ConcurrencyData = {
    outcome: 'read',
    state: record.state,
    appliedOperations: record.receipts.length,
    operationRevision: null,
  };
  if (record.state.runId !== command.payload.runId) throw new ProbeError('PROBE_UNAVAILABLE');
  if (command.action === 'spike.concurrency.read') return { record, data, changed: false };
  const { operationId, expectedRevision, value } = command.payload;
  const previous = record.receipts.find((receipt) => receipt.operationId === operationId);
  if (previous) {
    if (previous.expectedRevision !== expectedRevision || previous.value !== value)
      throw new ProbeError('OPERATION_MISMATCH');
    return {
      record,
      data: { ...data, outcome: 'replayed', operationRevision: previous.expectedRevision + 1 },
      changed: false,
    };
  }
  if (record.state.revision !== expectedRevision || record.state.revision >= 2)
    return { record, data: { ...data, outcome: 'conflict' }, changed: false };
  const next: ProbeRecord = {
    ...record,
    state: { ...record.state, value, revision: expectedRevision + 1 },
    receipts: [...record.receipts, { operationId, expectedRevision, value }],
  };
  return {
    record: next,
    data: {
      outcome: 'applied',
      state: next.state,
      appliedOperations: next.receipts.length,
      operationRevision: next.state.revision,
    },
    changed: true,
  };
}
