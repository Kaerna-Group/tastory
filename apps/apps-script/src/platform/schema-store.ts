import { SchemaMigrationError } from '../services/core-migration';
import { CORE_TABLES } from '../schema/core-schema';
import type { SchemaStore } from '../services/core-migration';

export function createSchemaStore(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): SchemaStore {
  return {
    read(name) {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet) return null;
      const rowCount = sheet.getLastRow(),
        columnCount = sheet.getLastColumn();
      if (rowCount === 0 && columnCount === 0)
        return { headers: [], rows: [], rowCount, columnCount };
      const expectedWidth = CORE_TABLES.find((table) => table.name === name)?.columns.length;
      if (columnCount !== expectedWidth) throw new SchemaMigrationError('HEADER_CONFLICT', name);
      const system = name === 'Meta' || name === 'SchemaMigrations';
      if (system && rowCount > 1000) throw new SchemaMigrationError('SYSTEM_TABLE_TOO_LARGE', name);
      const range = sheet.getRange(1, 1, system ? rowCount : 1, columnCount);
      if (range.getFormulas().some((row) => row.some(Boolean)))
        throw new SchemaMigrationError('FORMULA_IN_SCHEMA', name);
      const values = range
        .getValues()
        .map((row) =>
          row.map((value: unknown) =>
            value instanceof Date ? value.toISOString() : String(value),
          ),
        );
      return {
        headers: values[0] ?? [],
        rows: system ? values.slice(1) : [],
        rowCount,
        columnCount,
      };
    },
    create(name) {
      spreadsheet.insertSheet(name);
    },
    writeRow(name, row, values) {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet) throw new SchemaMigrationError('MISSING_TABLE', name);
      if (values.some((value) => /^[=+\-@]/.test(value)))
        throw new SchemaMigrationError('UNSAFE_SCHEMA_VALUE', name);
      // Explicit text format avoids locale coercion of versions, IDs and ISO timestamps.
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
