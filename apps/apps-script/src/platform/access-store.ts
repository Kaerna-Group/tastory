import { CORE_TABLES } from '../schema/core-schema';
import { createJournalStore } from './journal-store';
import { AccessError } from '../services/access-model';
import type { AccessStore } from '../services/access-mutations';

export function createAccessStore(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): AccessStore {
  const journal = createJournalStore(spreadsheet);
  return {
    journal,
    rows(table) {
      const definition = CORE_TABLES.find((t) => t.name === table);
      const sheet = spreadsheet.getSheetByName(table);
      if (!definition || !sheet || sheet.getLastColumn() !== definition.columns.length)
        throw new AccessError();
      const height = sheet.getLastRow();
      const limit =
        table === 'Users' || table === 'Workspaces' ? 10 : table === 'Meta' ? 1000 : 100;
      if (height < 1 || height > limit + 1) throw new AccessError();
      const range = sheet.getRange(1, 1, height, definition.columns.length);
      if (range.getFormulas().some((row) => row.some(Boolean))) throw new AccessError();
      const rows = range
        .getValues()
        .map((row) =>
          row.map((value: unknown) =>
            value instanceof Date ? value.toISOString() : String(value),
          ),
        );
      if (
        definition.columns.some((column, i) => rows[0]?.[i] !== column) ||
        rows.some((row) => row.some((value) => value.length > 4096))
      )
        throw new AccessError();
      return rows.slice(1);
    },
    write(table, row, values) {
      journal.core.writeRow(table, row, values);
    },
  };
}
