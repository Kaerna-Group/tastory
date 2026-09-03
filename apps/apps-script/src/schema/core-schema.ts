export const CORE_SCHEMA_VERSION = 1;
export const CORE_MIGRATION_ID = '001-core-schema';
export const CORE_MIGRATION_NAME = 'Core identity tables';

export const CORE_TABLES = [
  { name: 'Meta', columns: ['key', 'value', 'updated_at'] },
  {
    name: 'SchemaMigrations',
    columns: ['migration_id', 'name', 'checksum', 'applied_at', 'applied_by', 'status'],
  },
  {
    name: 'Users',
    columns: [
      'user_id',
      'google_sub',
      'email',
      'email_normalized',
      'display_name',
      'avatar_asset_id',
      'status',
      'created_at',
      'last_login_at',
      'row_revision',
    ],
  },
  {
    name: 'Invites',
    columns: [
      'invite_id',
      'workspace_id',
      'email_normalized',
      'role',
      'invited_by',
      'expires_at',
      'used_by',
      'used_at',
      'status',
    ],
  },
  {
    name: 'Workspaces',
    columns: [
      'workspace_id',
      'name',
      'owner_user_id',
      'default_app_theme_id',
      'default_canvas_theme_id',
      'created_at',
      'updated_at',
      'row_revision',
    ],
  },
  {
    name: 'WorkspaceMembers',
    columns: ['workspace_id', 'user_id', 'role', 'status', 'joined_at', 'row_revision'],
  },
] as const;

export type CoreTableName = (typeof CORE_TABLES)[number]['name'];
export type SystemTableName = 'Meta' | 'SchemaMigrations';
export const CORE_META_KEYS = [
  'schema_version',
  'api_version',
  'data_revision',
  'created_at',
  'drive_root_folder_id',
  'maintenance_mode',
] as const;

// Includes the migration semantics as well as headers; change via a new migration, not in place.
export const CORE_SCHEMA_FINGERPRINT = JSON.stringify({
  id: CORE_MIGRATION_ID,
  name: CORE_MIGRATION_NAME,
  version: CORE_SCHEMA_VERSION,
  tables: CORE_TABLES,
  metaKeys: CORE_META_KEYS,
  algorithm: 'headers-meta-log-checkpoint-v1',
});
