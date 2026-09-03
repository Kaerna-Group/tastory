import { CORE_TABLES } from '../schema/core-schema';
import { createSchemaStore } from './schema-store';
import { UsersImportError } from '../services/users-import';
import type { UsersImportStore } from '../services/users-import';

export function createUsersImportStore(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): UsersImportStore {
  return {
    ...createSchemaStore(spreadsheet),
    readIdentityRows(table) {
      const sheet = spreadsheet.getSheetByName(table);
      const columns = CORE_TABLES.find(({ name }) => name === table)?.columns;
      if (!sheet || !columns || sheet.getLastColumn() !== columns.length)
        throw new UsersImportError('IMPORT_SCHEMA_REQUIRED', table);
      const rowCount = sheet.getLastRow();
      if (rowCount < 1 || rowCount > 11)
        throw new UsersImportError('IMPORT_TARGET_CONFLICT', table);
      if (rowCount === 1) return [];
      const range = sheet.getRange(2, 1, rowCount - 1, columns.length);
      if (range.getFormulas().some((row) => row.some(Boolean)))
        throw new UsersImportError('IMPORT_UNSAFE_VALUE', table);
      return range
        .getValues()
        .map((row) =>
          row.map((value: unknown) =>
            value instanceof Date ? value.toISOString() : String(value),
          ),
        );
    },
  };
}
