import { CORE_SCHEMA_FINGERPRINT } from '../schema/core-schema';
import { planCoreSchema, SchemaMigrationError } from '../services/core-migration';
import { applyUsersImport, planUsersImport, UsersImportError } from '../services/users-import';
import { createUsersImportStore } from '../platform/users-import-store';

function runUsersImport(apply: boolean) {
  let lock: GoogleAppsScript.Lock.Lock | undefined;
  let locked = false;
  try {
    lock = LockService.getScriptLock();
    locked = lock.tryLock(10000);
    if (!locked) throw new UsersImportError('IMPORT_BUSY');
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('APP_ENV') !== 'staging')
      throw new UsersImportError('IMPORT_STAGING_REQUIRED');
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const driveRootId = properties.getProperty('DRIVE_FOLDER_ID');
    if (!spreadsheetId || !driveRootId) throw new UsersImportError('IMPORT_SCHEMA_REQUIRED');
    const sha256 = (value: string) =>
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
        .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
        .join('');
    const store = createUsersImportStore(SpreadsheetApp.openById(spreadsheetId));
    if (
      !planCoreSchema(store, {
        checksum: sha256(CORE_SCHEMA_FINGERPRINT),
        driveRootId,
        now: () => new Date(),
      }).alreadyApplied
    )
      throw new UsersImportError('IMPORT_SCHEMA_REQUIRED');
    let invitations: unknown, bindings: unknown;
    try {
      invitations = JSON.parse(properties.getProperty('STAGING_INVITES') ?? 'null');
      bindings = JSON.parse(properties.getProperty('STAGING_AUTH_BINDINGS') ?? 'null');
    } catch {
      throw new UsersImportError('IMPORT_SOURCE_INVALID');
    }
    const options = {
      invitations,
      bindings,
      ownerEmail: Session.getEffectiveUser().getEmail(),
      now: () => new Date(),
      uuid: () => Utilities.getUuid(),
      sha256,
    };
    const report = {
      ok: true,
      mode: apply ? 'apply' : 'plan',
      ...(apply ? applyUsersImport(store, options) : planUsersImport(store, options)),
    };
    console.info(JSON.stringify(report));
    return report;
  } catch (error) {
    const known = error instanceof UsersImportError || error instanceof SchemaMigrationError;
    const report = {
      ok: false,
      mode: apply ? 'apply' : 'plan',
      code: known ? error.code : 'IMPORT_UNAVAILABLE',
      ...(known && error.table ? { table: error.table } : {}),
    };
    console.info(JSON.stringify(report));
    return report;
  } finally {
    if (locked) lock?.releaseLock();
  }
}
// Owner-run data import. Public auth continues using the existing registry until cutover.
export function planStagingUsers() {
  return runUsersImport(false);
}
export function setupStagingUsers() {
  return runUsersImport(true);
}
