import { afterEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createSchemaStore } from './schema-store';
import { CORE_TABLES } from '../schema/core-schema';

function fixture(values: unknown[][], formula = '') {
  const range = {
    getValues: vi.fn(() => values),
    getFormulas: vi.fn(() => [[formula]]),
    setNumberFormat: vi.fn().mockReturnThis(),
    setValues: vi.fn().mockReturnThis(),
  };
  const sheet = {
    getLastRow: vi.fn(() => values.length),
    getLastColumn: vi.fn(() => Math.max(0, ...values.map((row) => row.length))),
    getRange: vi.fn(() => range),
  };
  const spreadsheet = {
    getSheetByName: vi.fn(() => sheet),
    insertSheet: vi.fn(),
  };
  return {
    sheet,
    range,
    spreadsheet,
    store: createSchemaStore(spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('Sheets schema adapter', () => {
  it('reads business headers only regardless of the number of user rows', () => {
    const columns = CORE_TABLES.find((table) => table.name === 'Users')?.columns;
    assert.ok(columns);
    const { store, sheet } = fixture([[...columns]]);
    sheet.getLastRow.mockReturnValue(500_000);
    expect(store.read('Users')).toMatchObject({ rowCount: 500_000, rows: [], headers: columns });
    expect(sheet.getRange).toHaveBeenCalledWith(1, 1, 1, columns.length);
  });
  it('normalizes Sheets dates/numbers in system rows without locale formatting', () => {
    const date = new Date('2026-09-03T12:00:00.000Z');
    const { store } = fixture([
      ['key', 'value', 'updated_at'],
      ['schema_version', 1, date],
    ]);
    expect(store.read('Meta')?.rows).toEqual([['schema_version', '1', date.toISOString()]]);
  });
  it('rejects formulas even when their displayed value matches a valid header', () => {
    const { store, range } = fixture([['key', 'value', 'updated_at']], '=CONCAT("k","ey")');
    expect(() => store.read('Meta')).toThrow('FORMULA_IN_SCHEMA');
    expect(range.getValues).not.toHaveBeenCalled();
  });
  it('bounds system reads and refuses extra columns before reading cell contents', () => {
    const { store, sheet } = fixture([['key', 'value', 'updated_at']]);
    sheet.getLastRow.mockReturnValue(1001);
    expect(() => store.read('Meta')).toThrow('SYSTEM_TABLE_TOO_LARGE');
    sheet.getLastColumn.mockReturnValue(4);
    expect(() => store.read('Meta')).toThrow('HEADER_CONFLICT');
    expect(sheet.getRange).not.toHaveBeenCalled();
  });
  it('writes explicitly formatted text and flushes before checkpoints', () => {
    const { store, range, sheet } = fixture([]);
    const flush = vi.fn();
    vi.stubGlobal('SpreadsheetApp', { flush });
    store.writeRow('Meta', 2, ['schema_version', '1', '2026-09-03T12:00:00.000Z']);
    expect(sheet.getRange).toHaveBeenCalledWith(2, 1, 1, 3);
    expect(range.setNumberFormat).toHaveBeenCalledWith('@');
    expect(range.setValues).toHaveBeenCalledWith([
      ['schema_version', '1', '2026-09-03T12:00:00.000Z'],
    ]);
    store.flush();
    expect(flush).toHaveBeenCalledOnce();
  });
  it.each(['=IMPORTDATA("private")', '+1', '-1', '@value'])(
    'refuses spreadsheet expressions: %s',
    (value) => {
      const { store, range } = fixture([]);
      expect(() => store.writeRow('Meta', 2, ['custom', value, 'timestamp'])).toThrow(
        'UNSAFE_SCHEMA_VALUE',
      );
      expect(range.setValues).not.toHaveBeenCalled();
    },
  );
});
