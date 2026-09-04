import { CORE_SCHEMA_FINGERPRINT } from '../schema/core-schema';
import { JOURNAL_SCHEMA_FINGERPRINT } from '../schema/journal-schema';
import { planCoreSchema } from '../services/core-migration';
import { planJournalSchema } from '../services/journal-migration';
import { JournalError } from '../services/journal-error';
import { createJournalStore } from './journal-store';
import {
  LEGACY_RECIPE_SCHEMA_FINGERPRINT,
  PHOTO_RECIPE_SCHEMA_FINGERPRINT,
  RECIPE_SCHEMA_FINGERPRINT,
  SETTINGS_RECIPE_SCHEMA_FINGERPRINT,
  STICKER_RECIPE_SCHEMA_FINGERPRINT,
} from '../schema/recipe-schema';
import { planRecipeSchema } from '../services/recipe-migration';
import { createRecipeStore } from './recipe-store';

export function sha256(value: string) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
    .join('');
}
export function journalMigrationOptions(driveRootId: string) {
  return {
    checksum: sha256(CORE_SCHEMA_FINGERPRINT),
    journalChecksum: sha256(JOURNAL_SCHEMA_FINGERPRINT),
    recipeChecksum: sha256(RECIPE_SCHEMA_FINGERPRINT),
    legacyRecipeChecksum: sha256(LEGACY_RECIPE_SCHEMA_FINGERPRINT),
    photoRecipeChecksum: sha256(PHOTO_RECIPE_SCHEMA_FINGERPRINT),
    settingsRecipeChecksum: sha256(SETTINGS_RECIPE_SCHEMA_FINGERPRINT),
    stickerRecipeChecksum: sha256(STICKER_RECIPE_SCHEMA_FINGERPRINT),
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
  if (
    version === '3' &&
    planRecipeSchema(createRecipeStore(spreadsheet), options).fromVersion === 3
  )
    return { schemaVersion: 3 as const, tablesChecked: 14 as const };
  if (
    version === '4' &&
    planRecipeSchema(createRecipeStore(spreadsheet), options).fromVersion === 4
  )
    return { schemaVersion: 4 as const, tablesChecked: 15 as const };
  if (
    version === '5' &&
    planRecipeSchema(createRecipeStore(spreadsheet), options).fromVersion === 5
  )
    return { schemaVersion: 5 as const, tablesChecked: 16 as const };
  if (
    version === '6' &&
    planRecipeSchema(createRecipeStore(spreadsheet), options).fromVersion === 6
  )
    return { schemaVersion: 6 as const, tablesChecked: 17 as const };
  if (version === '7' && planRecipeSchema(createRecipeStore(spreadsheet), options).alreadyApplied)
    return { schemaVersion: 7 as const, tablesChecked: 21 as const };
  throw new JournalError();
}
