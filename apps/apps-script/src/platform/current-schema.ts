import { CORE_SCHEMA_FINGERPRINT } from '../schema/core-schema';
import { JOURNAL_SCHEMA_FINGERPRINT } from '../schema/journal-schema';
import { planCoreSchema } from '../services/core-migration';
import { planJournalSchema } from '../services/journal-migration';
import { JournalError } from '../services/journal-error';
import { createJournalStore } from './journal-store';

export function sha256(value: string) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
    .join('');
}
export function journalMigrationOptions(driveRootId: string) {
  return {
    checksum: sha256(CORE_SCHEMA_FINGERPRINT),
    journalChecksum: sha256(JOURNAL_SCHEMA_FINGERPRINT),
    driveRootId,
    now: () => new Date(),
  };
}
export function inspectCurrentSchema(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  driveRootId: string,
) {
  const store = createJournalStore(spreadsheet);
  const version = store.core.read('Meta')?.rows.find((row) => row[0] === 'schema_version')?.[1];
  const options = journalMigrationOptions(driveRootId);
  if (version === '1' && planCoreSchema(store.core, options).alreadyApplied)
    return { schemaVersion: 1 as const, tablesChecked: 6 as const };
  if (version === '2' && planJournalSchema(store, options).alreadyApplied)
    return { schemaVersion: 2 as const, tablesChecked: 8 as const };
  throw new JournalError();
}
