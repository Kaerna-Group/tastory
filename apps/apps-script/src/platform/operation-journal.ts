import type { AuthData, JournalAction, JournalData, JournalEntry } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { resolveWorkspaceAccess, sheetsAuthConfigSchema } from '../auth/workspace-access';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';
import { applyJournalSchema, planJournalSchema } from '../services/journal-migration';
import { readJournal, runJournalCheck } from '../services/operation-journal';
import type { JournalOperation } from '../services/operation-journal';
import { JournalError } from '../services/journal-error';
import { createJournalStore } from './journal-store';
import { journalMigrationOptions, sha256 } from './current-schema';

export function operationJournal(
  action: JournalAction,
  requestId: string,
  session: AuthData,
): JournalData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new JournalError();
  try {
    const assertLive = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    assertLive();
    const properties = PropertiesService.getScriptProperties();
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const driveRootId = properties.getProperty('DRIVE_FOLDER_ID');
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(properties.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    if (
      properties.getProperty('APP_ENV') !== 'staging' ||
      !spreadsheetId ||
      !driveRootId ||
      !config.success
    )
      throw new JournalError();
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const directory = readWorkspaceDirectory(spreadsheet);
    const access = resolveWorkspaceAccess(directory, session.user.id, config.data.workspaceId);
    if (access.role !== 'owner') throw new AuthError('ACCESS_DENIED');
    const store = createJournalStore(spreadsheet);
    const options = { ...journalMigrationOptions(driveRootId), beforeWrite: assertLive };
    const plan = planJournalSchema(store, options);
    const entry = (operation: JournalOperation, auditRecorded: boolean): JournalEntry => ({
      id: operation.request_id,
      action: operation.action,
      actorName:
        directory.users.find((user) => user.user_id === operation.user_id)?.display_name ||
        directory.users.find((user) => user.user_id === operation.user_id)?.email ||
        'Участник',
      status: operation.status,
      startedAt: operation.started_at,
      completedAt: operation.completed_at || null,
      auditRecorded,
      canRetry:
        operation.action === 'admin.operations.check' &&
        operation.status === 'started' &&
        operation.user_id === access.userId,
    });
    if (action === 'admin.operations.initialize') {
      assertLive();
      applyJournalSchema(store, options);
      assertLive();
      return { kind: 'initialized', schemaVersion: 2, alreadyApplied: plan.alreadyApplied };
    }
    if (action === 'admin.operations.list') {
      const state = plan.alreadyApplied ? readJournal(store) : { operations: [], audit: [] };
      const auditIds = new Set(state.audit.map((event) => event.request_id));
      const operations = state.operations.filter(
        (operation) => operation.workspace_id === access.workspaceId,
      );
      const entries = operations
        .slice(-50)
        .reverse()
        .map((operation) => entry(operation, auditIds.has(operation.request_id)));
      assertLive();
      return {
        kind: 'list',
        ready: plan.alreadyApplied,
        schemaVersion: plan.alreadyApplied ? 2 : 1,
        checkedAt: new Date().toISOString(),
        total: operations.length,
        entries,
      };
    }
    if (!plan.alreadyApplied) throw new JournalError('JOURNAL_NOT_READY');
    const result = runJournalCheck(
      store,
      { requestId, userId: access.userId, workspaceId: access.workspaceId },
      { now: () => new Date(), sha256, assertAuthorized: assertLive },
    );
    assertLive();
    return {
      kind: 'check',
      outcome: result.outcome,
      entry: entry(result.operation, true),
      result: { kind: 'journal-check', verified: true },
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof JournalError) throw error;
    throw new JournalError();
  } finally {
    lock.releaseLock();
  }
}
