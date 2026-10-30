import type { TFunction } from 'i18next';

import type {
  FileParseResult,
  ImportFileError,
  ImportRowError,
} from '@/lib/utils/file-parsing';

export type { ImportFileError, ImportRowError };

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

/**
 * Why a file was refused whole, in the reader's language: a missing
 * required column is `common.import.missingColumns`, naming the columns by
 * the header the parser accepts (a translated name would be refused too) and
 * the headers the file has. `tCommon` is the `common` namespace's `t`.
 */
export function importFileErrorMessage(
  tCommon: TFunction,
  error: ImportFileError,
): string {
  switch (error.code) {
    case 'missingColumns':
      return tCommon('import.missingColumns', {
        count: error.columns.length,
        columns: error.columns.join(', '),
        foundCount: error.found.length,
        found: error.found.join(', '),
      });
    case 'unsupportedFormat':
      return tCommon('validation.unsupportedFileType');
    case 'unreadable':
      return tCommon('import.unreadable');
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}
