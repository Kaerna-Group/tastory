import { z } from 'zod';
import { JOURNAL_LIMIT, JOURNAL_TABLES } from '../schema/journal-schema';
import type { JournalStore } from './journal-migration';
import { JournalError } from './journal-error';
import { accessActions, accessPlanSchema } from './access-model';

const date = z.iso.datetime(),
  id = z.uuid(),
  empty = z.literal('');
export const JOURNAL_CHECK_ACTION = 'admin.operations.check';
const resultJson = '{"kind":"journal-check","verified":true}';
const auditJson = '{"kind":"journal-check"}';
const checkOperationSchema = z
  .strictObject({
    request_id: id,
    workspace_id: id,
    user_id: id,
    action: z.literal(JOURNAL_CHECK_ACTION),
    entity_type: z.literal('system'),
    entity_id: id,
    payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['started', 'committed']),
    result_json: z.union([empty, z.literal(resultJson)]),
    error_code: empty,
    started_at: date,
    completed_at: z.union([empty, date]),
  })
  .refine(
    (row) =>
      row.entity_id === row.workspace_id &&
      (row.status === 'started'
        ? row.result_json === '' && row.completed_at === ''
        : row.result_json === resultJson &&
          row.completed_at !== '' &&
          Date.parse(row.completed_at) >= Date.parse(row.started_at)),
  );
const accessOperationSchema = z
  .strictObject({
    request_id: id,
    workspace_id: id,
    user_id: id,
    action: z.enum(accessActions),
    entity_type: z.enum(['invite', 'membership']),
    entity_id: id,
    payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['started', 'committed']),
    result_json: z
      .string()
      .max(4096)
      .refine((value) => {
        try {
          return accessPlanSchema.safeParse(JSON.parse(value)).success;
        } catch {
          return false;
        }
      }),
    error_code: empty,
    started_at: date,
    completed_at: z.union([empty, date]),
  })
  .refine((op) => {
    try {
      const parsed = accessPlanSchema.safeParse(JSON.parse(op.result_json));
      return (
        parsed.success &&
        parsed.data.entityId === op.entity_id &&
        op.entity_type === (op.action === 'admin.members.update' ? 'membership' : 'invite') &&
        (op.status === 'started'
          ? op.completed_at === ''
          : op.completed_at !== '' && Date.parse(op.completed_at) >= Date.parse(op.started_at))
      );
    } catch {
      return false;
    }
  });
const operationSchema = z.union([checkOperationSchema, accessOperationSchema]);
const checkAuditSchema = z
  .strictObject({
    event_id: id,
    request_id: id,
    workspace_id: id,
    user_id: id,
    entity_type: z.literal('system'),
    entity_id: id,
    action: z.literal(JOURNAL_CHECK_ACTION),
    before_hash: empty,
    after_hash: empty,
    metadata_json: z.literal(auditJson),
    created_at: date,
  })
  .refine((row) => row.event_id === row.request_id && row.entity_id === row.workspace_id);
const accessAuditSchema = z
  .strictObject({
    event_id: id,
    request_id: id,
    workspace_id: id,
    user_id: id,
    entity_type: z.enum(['invite', 'membership']),
    entity_id: id,
    action: z.enum(accessActions),
    before_hash: z.string().regex(/^[a-f0-9]{64}$/),
    after_hash: z.string().regex(/^[a-f0-9]{64}$/),
    metadata_json: z.literal('{"kind":"access-write"}'),
    created_at: date,
  })
  .refine((row) => row.event_id === row.request_id);
const auditSchema = z.union([checkAuditSchema, accessAuditSchema]);
export type JournalOperation = z.infer<typeof operationSchema>;
type JournalAudit = z.infer<typeof auditSchema>;

export function readJournal(store: JournalStore) {
  const records = JOURNAL_TABLES.map(({ name, columns }) => {
    const table = store.readTable(name);
    if (
      !table ||
      table.columnCount !== columns.length ||
      columns.some((column, i) => table.headers[i] !== column)
    )
      throw new JournalError();
    return table.rows.map((row) =>
      Object.fromEntries(columns.map((column, i) => [column, row[i] ?? ''])),
    );
  });
  const operations = z.array(operationSchema).max(JOURNAL_LIMIT).safeParse(records[0]);
  const audit = z.array(auditSchema).max(JOURNAL_LIMIT).safeParse(records[1]);
  if (!operations.success || !audit.success) throw new JournalError();
  if (
    new Set(operations.data.map((op) => op.request_id)).size !== operations.data.length ||
    new Set(audit.data.map((event) => event.request_id)).size !== audit.data.length
  )
    throw new JournalError();
  const operationById = new Map(operations.data.map((op) => [op.request_id, op]));
  const auditById = new Map(audit.data.map((event) => [event.request_id, event]));
  for (const event of audit.data) {
    const op = operationById.get(event.request_id);
    if (
      !op ||
      op.workspace_id !== event.workspace_id ||
      op.user_id !== event.user_id ||
      op.action !== event.action ||
      op.entity_type !== event.entity_type ||
      op.entity_id !== event.entity_id ||
      Date.parse(op.started_at) > Date.parse(event.created_at) ||
      (op.status === 'committed' && op.completed_at !== event.created_at)
    )
      throw new JournalError();
  }
  if (operations.data.some((op) => op.status === 'committed' && !auditById.has(op.request_id)))
    throw new JournalError();
  return { operations: operations.data, audit: audit.data };
}

type JournalIdentity = { requestId: string; workspaceId: string; userId: string };
type JournalOptions = {
  now: () => Date;
  sha256: (value: string) => string;
  assertAuthorized: () => void;
};
// Only the journal integrity check is registered in this slice. Product mutations must add an
// explicit resumable state transition; a generic "retry any callback" would duplicate side effects.
export function runJournalCheck(
  store: JournalStore,
  identity: JournalIdentity,
  options: JournalOptions,
) {
  const input = z.strictObject({ requestId: id, workspaceId: id, userId: id }).parse(identity);
  options.assertAuthorized();
  const payloadHash = options.sha256(
    JSON.stringify({
      version: 1,
      action: JOURNAL_CHECK_ACTION,
      workspaceId: input.workspaceId,
      userId: input.userId,
      payload: {},
    }),
  );
  if (!/^[a-f0-9]{64}$/.test(payloadHash)) throw new JournalError();
  let state = readJournal(store);
  let index = state.operations.findIndex((op) => op.request_id === input.requestId);
  let operation = state.operations[index];
  if (
    operation &&
    (operation.workspace_id !== input.workspaceId ||
      operation.user_id !== input.userId ||
      operation.payload_hash !== payloadHash ||
      operation.action !== JOURNAL_CHECK_ACTION)
  )
    throw new JournalError('OPERATION_MISMATCH');
  if (operation?.status === 'committed') {
    options.assertAuthorized();
    return { outcome: 'replayed' as const, operation };
  }
  if (!operation) {
    if (state.operations.length >= JOURNAL_LIMIT || state.audit.length >= JOURNAL_LIMIT)
      throw new JournalError('JOURNAL_LIMIT');
    operation = {
      request_id: input.requestId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      action: JOURNAL_CHECK_ACTION,
      entity_type: 'system',
      entity_id: input.workspaceId,
      payload_hash: payloadHash,
      status: 'started',
      result_json: '',
      error_code: '',
      started_at: options.now().toISOString(),
      completed_at: '',
    };
    index = state.operations.length;
    options.assertAuthorized();
    writeOperation(store, index, operation);
    store.flush();
    state = readJournal(store);
    if (JSON.stringify(state.operations[index]) !== JSON.stringify(operation))
      throw new JournalError();
  }
  let event = state.audit.find((candidate) => candidate.request_id === input.requestId);
  if (!event) {
    if (state.audit.length >= JOURNAL_LIMIT) throw new JournalError('JOURNAL_LIMIT');
    event = {
      event_id: input.requestId,
      request_id: input.requestId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      entity_type: 'system',
      entity_id: input.workspaceId,
      action: JOURNAL_CHECK_ACTION,
      before_hash: '',
      after_hash: '',
      metadata_json: auditJson,
      created_at: options.now().toISOString(),
    };
    options.assertAuthorized();
    appendAudit(store, state.audit.length, event);
    store.flush();
    state = readJournal(store);
    if (
      JSON.stringify(state.audit.find((candidate) => candidate.request_id === input.requestId)) !==
      JSON.stringify(event)
    )
      throw new JournalError();
  }
  const committed: JournalOperation = {
    ...operation,
    status: 'committed',
    result_json: resultJson,
    completed_at: event.created_at,
  };
  options.assertAuthorized();
  writeOperation(store, index, committed);
  store.flush();
  const verified = readJournal(store).operations[index];
  if (JSON.stringify(verified) !== JSON.stringify(committed)) throw new JournalError();
  return { outcome: 'committed' as const, operation: committed };
}
export function writeOperation(store: JournalStore, index: number, operation: JournalOperation) {
  const validated = operationSchema.parse(operation);
  store.writeTableRow(
    'Operations',
    index + 2,
    JOURNAL_TABLES[0].columns.map((column) => validated[column]),
  );
}
export function appendAudit(store: JournalStore, count: number, event: JournalAudit) {
  const validated = auditSchema.parse(event);
  store.writeTableRow(
    'AuditLog',
    count + 2,
    JOURNAL_TABLES[1].columns.map((column) => validated[column]),
  );
}
