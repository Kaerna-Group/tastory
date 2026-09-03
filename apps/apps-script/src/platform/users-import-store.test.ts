import { describe, expect, it, vi } from 'vitest';
import { createUsersImportStore } from './users-import-store';

function fixture() {
  const range = {
    getFormulas: vi.fn(() => [[]] as string[][]),
    getValues: vi.fn(() => [
      ['uuid', 'sub', 'email', 'email', '', '', 'active', new Date('2026-09-02T10:00:00Z'), '', 1],
    ]),
  };
  const sheet = {
    getLastRow: vi.fn(() => 2),
    getLastColumn: vi.fn(() => 10),
    getRange: vi.fn(() => range),
  };
  const spreadsheet = {
    getSheetByName: () => sheet,
  } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet;
  return { sheet, range, store: createUsersImportStore(spreadsheet) };
}
describe('identity import Sheets adapter', () => {
  it('reads only bounded identity rows and converts dates and numeric revisions', () => {
    const { store, sheet } = fixture();
    const rows = store.readIdentityRows('Users');
    expect(rows[0]?.[7]).toBe('2026-09-02T10:00:00.000Z');
    expect(rows[0]?.[9]).toBe('1');
    expect(sheet.getRange).toHaveBeenCalledWith(2, 1, 1, 10);
  });
  it('does not read cells in an empty identity table', () => {
    const { store, sheet } = fixture();
    sheet.getLastRow.mockReturnValue(1);
    expect(store.readIdentityRows('Users')).toEqual([]);
    expect(sheet.getRange).not.toHaveBeenCalled();
  });
  it('rejects a missing header, unexpected width or more than ten data rows before a range read', () => {
    const { store, sheet } = fixture();
    sheet.getLastRow.mockReturnValue(12);
    expect(() => store.readIdentityRows('Users')).toThrow('IMPORT_TARGET_CONFLICT');
    sheet.getLastRow.mockReturnValue(0);
    expect(() => store.readIdentityRows('Users')).toThrow('IMPORT_TARGET_CONFLICT');
    sheet.getLastColumn.mockReturnValue(11);
    expect(() => store.readIdentityRows('Users')).toThrow('IMPORT_SCHEMA_REQUIRED');
    expect(sheet.getRange).not.toHaveBeenCalled();
  });
  it('rejects formulas without reading their calculated content', () => {
    const { store, range } = fixture();
    range.getFormulas.mockReturnValue([['=SECRET()']]);
    expect(() => store.readIdentityRows('Users')).toThrow('IMPORT_UNSAFE_VALUE');
    expect(range.getValues).not.toHaveBeenCalled();
  });
});
