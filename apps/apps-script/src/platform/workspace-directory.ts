import { CORE_TABLES } from '../schema/core-schema';
import type { CoreTableName } from '../schema/core-schema';
import { AuthError } from '../auth/google-token';
import type { GoogleIdentity } from '../auth/google-token';
import {
  parseWorkspaceDirectory,
  resolveWorkspaceAccess,
  sheetsAuthConfigSchema,
} from '../auth/workspace-access';
import { usersImportCheckpointSchema } from '../services/users-import';
import { acceptInvitation } from '../services/access-mutations';
import { createAccessStore } from './access-store';
import { sha256 } from './current-schema';

export const SHEETS_AUTH_CONFIG_KEY = 'SHEETS_AUTH_CONFIG';

function readRecords(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: CoreTableName,
  limit: number,
) {
  const sheet = spreadsheet.getSheetByName(name);
  const columns = CORE_TABLES.find((definition) => definition.name === name)?.columns;
  if (!sheet || !columns || sheet.getLastColumn() !== columns.length)
    throw new AuthError('AUTH_UNAVAILABLE');
  const height = sheet.getLastRow();
  if (height < 1 || height > limit + 1) throw new AuthError('AUTH_UNAVAILABLE');
  const range = sheet.getRange(1, 1, height, columns.length);
  if (range.getFormulas().some((row) => row.some(Boolean))) throw new AuthError('AUTH_UNAVAILABLE');
  const values = range
    .getValues()
    .map((row) =>
      row.map((value: unknown) => (value instanceof Date ? value.toISOString() : String(value))),
    );
  if (columns.some((column, index) => values[0]?.[index] !== column))
    throw new AuthError('AUTH_UNAVAILABLE');
  return values
    .slice(1)
    .map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])));
}

// Caller holds the common ScriptLock. Memberships are read on each request without a cache.
export function readWorkspaceDirectory(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet) {
  const metaRows = readRecords(spreadsheet, 'Meta', 1000);
  const meta = new Map(metaRows.map((row) => [row.key, row.value]));
  if (
    meta.size !== metaRows.length ||
    metaRows.some((row) => !row.key) ||
    !['1', '2', '3', '4', '5', '6'].includes(meta.get('schema_version') ?? '') ||
    meta.get('maintenance_mode') !== 'false'
  )
    throw new AuthError('AUTH_UNAVAILABLE');
  const rawCheckpoint = meta.get('users_import_v1');
  if (!rawCheckpoint || rawCheckpoint.length > 4096) throw new AuthError('AUTH_UNAVAILABLE');
  const checkpoint = usersImportCheckpointSchema.safeParse(JSON.parse(rawCheckpoint));
  if (!checkpoint.success || checkpoint.data.state !== 'applied')
    throw new AuthError('AUTH_UNAVAILABLE');
  const revision = meta.get('data_revision') ?? '';
  if (
    !/^(0|[1-9]\d*)$/.test(revision) ||
    !Number.isSafeInteger(Number(revision)) ||
    Number(revision) < checkpoint.data.baseRevision + 1
  )
    throw new AuthError('AUTH_UNAVAILABLE');
  return parseWorkspaceDirectory({
    users: readRecords(spreadsheet, 'Users', 10),
    workspaces: readRecords(spreadsheet, 'Workspaces', 10),
    members: readRecords(spreadsheet, 'WorkspaceMembers', 100),
  });
}

export function authenticateSheets(
  identity: GoogleIdentity,
  rawConfig: string,
  spreadsheetId: string | null,
  allowJoin = false,
) {
  const config = sheetsAuthConfigSchema.safeParse(JSON.parse(rawConfig));
  if (!config.success || !spreadsheetId) throw new AuthError('AUTH_UNAVAILABLE');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let directory = readWorkspaceDirectory(spreadsheet);
  const store = createAccessStore(spreadsheet);
  if (
    store
      .rows('Meta')
      .some(
        (row) => row[0] === 'schema_version' && ['2', '3', '4', '5', '6'].includes(row[1] ?? ''),
      )
  ) {
    acceptInvitation(store, identity, config.data.workspaceId, allowJoin, {
      now: () => new Date(),
      uuid: () => Utilities.getUuid(),
      sha256,
      assertLive: () => {
        if (Date.parse(identity.expiresAt) <= Date.now()) throw new AuthError('UNAUTHENTICATED');
      },
    });
    directory = readWorkspaceDirectory(spreadsheet);
  }
  const access = resolveWorkspaceAccess(directory, identity.sub, config.data.workspaceId);
  if (Date.parse(identity.expiresAt) <= Date.now()) throw new AuthError('UNAUTHENTICATED');
  return {
    // The existing auth/spike protocol keeps its opaque ID so accepted private photo ownership
    // and concurrency receipts remain valid. Core permissions use the internal UUID above.
    user: { id: identity.sub, email: identity.email, name: identity.name, role: access.role },
    expiresAt: identity.expiresAt,
  };
}
