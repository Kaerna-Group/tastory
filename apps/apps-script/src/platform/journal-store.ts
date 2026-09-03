import { JOURNAL_LIMIT, JOURNAL_TABLES } from '../schema/journal-schema';
import { JournalError } from '../services/journal-error';
import type { JournalStore } from '../services/journal-migration';
import { createSchemaStore } from './schema-store';

export function createJournalStore(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): JournalStore {
  return {
    core: createSchemaStore(spreadsheet),
    readTable(name) {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet) return null;
      const rowCount = sheet.getLastRow(),
        columnCount = sheet.getLastColumn();
      if (rowCount === 0 && columnCount === 0)
        return { rowCount, columnCount, headers: [], rows: [] };
      const width = JOURNAL_TABLES.find((table) => table.name === name)?.columns.length;
      if (columnCount !== width || rowCount < 1 || rowCount > JOURNAL_LIMIT + 1)
        throw new JournalError();
      const range = sheet.getRange(1, 1, rowCount, columnCount);
      if (range.getFormulas().some((row) => row.some(Boolean))) throw new JournalError();
      const values = range
        .getValues()
        .map((row) =>
          row.map((value: unknown) =>
            value instanceof Date ? value.toISOString() : String(value),
          ),
        );
      if (values.some((row) => row.some((value) => value.length > 4096))) throw new JournalError();
      return { rowCount, columnCount, headers: values[0] ?? [], rows: values.slice(1) };
    },
    createTable(name) {
      spreadsheet.insertSheet(name);
    },
    writeTableRow(name, row, values) {
      const sheet = spreadsheet.getSheetByName(name);
      const width = JOURNAL_TABLES.find((table) => table.name === name)?.columns.length;
      if (
        !sheet ||
        values.length !== width ||
        row < 1 ||
        row > JOURNAL_LIMIT + 1 ||
        values.some((value) => value.length > 4096 || /^[=+\-@]/.test(value))
      )
        throw new JournalError();
      sheet
        .getRange(row, 1, 1, values.length)
        .setNumberFormat('@')
        .setValues([[...values]]);
    },
    flush() {
      SpreadsheetApp.flush();
    },
  };
}
