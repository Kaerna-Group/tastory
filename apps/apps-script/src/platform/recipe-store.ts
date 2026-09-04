import { RECIPE_TABLES, RECIPE_ROW_LIMIT, RECIPE_OPERATION_LIMIT } from '../schema/recipe-schema';
import { RecipeStorageError } from '../services/recipe-storage';
import type { RecipeStore } from '../services/recipe-storage';
import { createJournalStore } from './journal-store';

export function createRecipeStore(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): RecipeStore {
  return {
    journal: createJournalStore(spreadsheet),
    read(table) {
      const sheet = spreadsheet.getSheetByName(table);
      if (!sheet) return null;
      const rowCount = sheet.getLastRow(),
        columnCount = sheet.getLastColumn();
      if (rowCount === 0 && columnCount === 0)
        return { rowCount, columnCount, headers: [], rows: [] };
      const width = RECIPE_TABLES.find((definition) => definition.name === table)?.columns.length;
      const limit = table === 'RecipeOperations' ? RECIPE_OPERATION_LIMIT : RECIPE_ROW_LIMIT;
      if (columnCount !== width || rowCount < 1 || rowCount > limit + 1)
        throw new RecipeStorageError();
      const range = sheet.getRange(1, 1, rowCount, columnCount);
      if (range.getFormulas().some((row) => row.some(Boolean))) throw new RecipeStorageError();
      const rows = range.getValues().map((row) => row.map((value: unknown) => String(value)));
      if (rows.some((row) => row.some((value) => value.length > 20002)))
        throw new RecipeStorageError();
      return { rowCount, columnCount, headers: rows[0] ?? [], rows: rows.slice(1) };
    },
    create(table) {
      spreadsheet.insertSheet(table);
    },
    writeRows(table, firstRow, rows) {
      const sheet = spreadsheet.getSheetByName(table);
      const width = RECIPE_TABLES.find((definition) => definition.name === table)?.columns.length;
      const limit = table === 'RecipeOperations' ? RECIPE_OPERATION_LIMIT : RECIPE_ROW_LIMIT;
      if (
        !sheet ||
        !width ||
        !rows.length ||
        firstRow < 1 ||
        firstRow + rows.length > limit + 2 ||
        rows.some(
          (row) =>
            row.length !== width ||
            row.some((value) => value.length > 20002 || /^[=+\-@]/.test(value)),
        )
      )
        throw new RecipeStorageError('RECIPE_LIMIT');
      const requiredRows = firstRow + rows.length - 1;
      if (requiredRows > sheet.getMaxRows())
        sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
      sheet
        .getRange(firstRow, 1, rows.length, width)
        .setNumberFormat('@')
        .setValues(rows.map((row) => [...row]));
    },
    deleteRows(table, firstRow, count) {
      const sheet = spreadsheet.getSheetByName(table);
      if (!sheet || firstRow < 2 || count < 1 || firstRow + count - 1 > sheet.getLastRow())
        throw new RecipeStorageError();
      sheet.deleteRows(firstRow, count);
    },
    writeState(row, state) {
      const sheet = spreadsheet.getSheetByName('RecipeOperations');
      const definition = RECIPE_TABLES.find((table) => table.name === 'RecipeOperations');
      const column = definition?.columns.indexOf('state') ?? -1;
      if (!sheet || column < 0 || row < 2 || row > sheet.getLastRow() || state.length > 100)
        throw new RecipeStorageError();
      // This single cell is the publication point. All payload cells are immutable.
      sheet
        .getRange(row, column + 1, 1, 1)
        .setNumberFormat('@')
        .setValues([[JSON.stringify(state)]]);
    },
    flush() {
      SpreadsheetApp.flush();
    },
  };
}
