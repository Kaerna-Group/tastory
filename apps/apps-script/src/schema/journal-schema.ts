export const JOURNAL_SCHEMA_VERSION = 2;
export const JOURNAL_MIGRATION_ID = '002-operation-journal';
export const JOURNAL_MIGRATION_NAME = 'Operations and audit journal';
export const JOURNAL_LIMIT = 1000;
export const JOURNAL_TABLES = [
  {
    name: 'Operations',
    columns: [
      'request_id',
      'workspace_id',
      'user_id',
      'action',
      'entity_type',
      'entity_id',
      'payload_hash',
      'status',
      'result_json',
      'error_code',
      'started_at',
      'completed_at',
    ],
  },
  {
    name: 'AuditLog',
    columns: [
      'event_id',
      'request_id',
      'workspace_id',
      'user_id',
      'entity_type',
      'entity_id',
      'action',
      'before_hash',
      'after_hash',
      'metadata_json',
      'created_at',
    ],
  },
] as const;
export type JournalTableName = (typeof JOURNAL_TABLES)[number]['name'];
export const JOURNAL_SCHEMA_FINGERPRINT = JSON.stringify({
  id: JOURNAL_MIGRATION_ID,
  name: JOURNAL_MIGRATION_NAME,
  version: JOURNAL_SCHEMA_VERSION,
  tables: JOURNAL_TABLES,
  algorithm: 'core-v1-preserved-journal-headers-log-checkpoint-v1',
});
