import type { TFunction } from 'i18next';

import type { FileParseResult, ImportRowError } from '@/lib/utils/file-parsing';

export type { ImportRowError };

/** One refused row as a bulk door answers it, at the index the row was sent. */
export interface BulkRowError {
  index: number;
  error: string;
  errorCode: string;
  issues?: { path: string; message: string }[];
}

/**
 * The rows a file import could not land, by the line the user sees in the
 * spreadsheet: the rows the parser refused (field + reason keys), plus the
 * ones the server refused mapped back from their position in what was SENT
 * to the line they came from, each carrying its first issue in the server's
 * `field: reason` voice.
 */
export function mergeImportRowErrors(
  parsed: Pick<FileParseResult<unknown>, 'rows' | 'rowErrors'>,
  serverErrors: readonly BulkRowError[],
): ImportRowError[] {
  const merged: ImportRowError[] = [...parsed.rowErrors];
  for (const entry of serverErrors) {
    const first = entry.issues?.[0];
    merged.push({
      row: parsed.rows[entry.index] ?? entry.index + 1,
      message: first ? `${first.path}: ${first.message}` : entry.error,
    });
  }
  return merged.sort((a, b) => a.row - b.row);
}

/**
 * What is wrong with a refused row, in the reader's language: a parser
 * refusal is its `common.import.reasons.<reason>` sentence over the
 * `common.import.fields.<field>` label, or `common.import.unpairedQuotes` for
 * a CSV row whose quotes don't pair up; a server refusal is the server's own
 * text. `tCommon` is the `common` namespace's `t`.
 */
export function importRowErrorMessage(
  tCommon: TFunction,
  entry: ImportRowError,
): string {
  if ('message' in entry) return entry.message;
  if ('quotes' in entry) return tCommon('import.unpairedQuotes');
  return tCommon(`import.reasons.${entry.reason}`, {
    ...entry.values,
    field: tCommon(`import.fields.${entry.field}`),
  });
}

/** The `common.import.rowError` line for a refused row: "Row N: …". */
export function importRowErrorLine(
  tCommon: TFunction,
  entry: ImportRowError,
): string {
  return tCommon('import.rowError', {
    row: entry.row,
    message: importRowErrorMessage(tCommon, entry),
  });
}
