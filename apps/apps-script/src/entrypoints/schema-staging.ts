import { CORE_SCHEMA_FINGERPRINT } from '../schema/core-schema';
import { createSchemaStore } from '../platform/schema-store';
import { applyCoreSchema, planCoreSchema, SchemaMigrationError } from '../services/core-migration';

function runSchema(apply: boolean) {
  let lock: GoogleAppsScript.Lock.Lock | undefined;
  let locked = false;
  try {
    lock = LockService.getScriptLock();
    locked = lock.tryLock(10_000);
    if (!locked) throw new SchemaMigrationError('SCHEMA_BUSY');
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('APP_ENV') !== 'staging')
      throw new SchemaMigrationError('STAGING_REQUIRED');
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const driveRootId = properties.getProperty('DRIVE_FOLDER_ID');
    if (!spreadsheetId || !driveRootId) throw new SchemaMigrationError('STORAGE_NOT_CONFIGURED');
    const checksum = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      CORE_SCHEMA_FINGERPRINT,
      Utilities.Charset.UTF_8,
    )
      .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
      .join('');
    const options = { checksum, driveRootId, now: () => new Date() };
    const store = createSchemaStore(SpreadsheetApp.openById(spreadsheetId));
    const report = {
      ok: true,
      mode: apply ? 'apply' : 'plan',
      ...(apply ? applyCoreSchema(store, options) : planCoreSchema(store, options)),
    };
    console.info(JSON.stringify(report));
    return report;
  } catch (error) {
    const code = error instanceof SchemaMigrationError ? error.code : 'SCHEMA_SERVICE_UNAVAILABLE';
    const report = {
      ok: false,
      mode: apply ? 'apply' : 'plan',
      code,
      ...(error instanceof SchemaMigrationError && error.table ? { table: error.table } : {}),
    };
    console.info(JSON.stringify(report));
    return report;
  } finally {
    if (locked) lock?.releaseLock();
  }
}

// Editor-only entrypoints: no public HTTP actions, no identity registry changes.
export function planStagingSchema() {
  return runSchema(false);
}
export function setupStagingSchema() {
  return runSchema(true);
}
