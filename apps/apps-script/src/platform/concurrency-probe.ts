import type { AuthData, ConcurrencyCommand, ConcurrencyData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import {
  applyProbe,
  initialProbe,
  probeRecordSchema,
  ProbeError,
} from '../services/concurrency-probe';

const sheetName = '_TastoryConcurrency';
const header = 'tastory.concurrency.v1';
const maxRuns = 100;
export function concurrencyProbe(command: ConcurrencyCommand, session: AuthData): ConcurrencyData {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('APP_ENV') !== 'staging') throw new ProbeError('PROBE_UNAVAILABLE');
  if (session.user.role !== 'owner') throw new AuthError('ACCESS_DENIED');
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new ProbeError('PROBE_UNAVAILABLE');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10_000)) throw new ProbeError('PROBE_UNAVAILABLE');
  try {
    if (Date.parse(session.expiresAt) <= Date.now()) throw new AuthError('UNAUTHENTICATED');
    const ownerKey = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      session.user.id,
      Utilities.Charset.UTF_8,
    )
      .map((byte) => (byte & 255).toString(16).padStart(2, '0'))
      .join('');
    const book = SpreadsheetApp.openById(spreadsheetId);
    let sheet = book.getSheetByName(sheetName);
    const empty = initialProbe(ownerKey, command.payload.runId);
    // Reads never provision a sheet. Unknown existing sheet layouts are never overwritten.
    if (!sheet && command.action === 'spike.concurrency.read')
      return applyProbe(empty, command).data;
    if (!sheet) {
      sheet = book.insertSheet(sheetName);
      sheet.getRange(1, 1).setValue(header);
      SpreadsheetApp.flush();
    }
    const lastRow = sheet.getLastRow();
    if (
      sheet.getLastColumn() !== 1 ||
      lastRow < 1 ||
      lastRow > maxRuns + 1 ||
      sheet.getRange(1, 1).getValue() !== header
    )
      throw new ProbeError('PROBE_UNAVAILABLE');
    const rows: unknown[][] = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
    const records = rows.map(([value]) => {
      if (typeof value !== 'string' || value.length > 4096)
        throw new ProbeError('PROBE_UNAVAILABLE');
      return probeRecordSchema.parse(JSON.parse(value));
    });
    const keys = records.map((record) => `${record.ownerKey}:${record.state.runId}`);
    if (new Set(keys).size !== keys.length) throw new ProbeError('PROBE_UNAVAILABLE');
    const index = keys.indexOf(`${ownerKey}:${command.payload.runId}`);
    const result = applyProbe(records[index] ?? empty, command);
    if (result.changed) {
      if (index < 0 && records.length >= maxRuns) throw new ProbeError('PROBE_LIMIT');
      const cell = sheet.getRange(index < 0 ? lastRow + 1 : index + 2, 1);
      const serialized = JSON.stringify(result.record);
      // State and deduplication receipt are one cell; flush before releasing the same script lock.
      cell.setValue(serialized);
      SpreadsheetApp.flush();
      if (cell.getValue() !== serialized) throw new ProbeError('PROBE_UNAVAILABLE');
    }
    return result.data;
  } catch (error) {
    if (error instanceof ProbeError || error instanceof AuthError) throw error;
    throw new ProbeError('PROBE_UNAVAILABLE');
  } finally {
    lock.releaseLock();
  }
}
