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
 * spreadsheet: the rows the parser refused, plus the ones the server refused
 * mapped back from their position in what was SENT to the line they came
 * from. Each carries its first issue in the server's `field: reason` voice.
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
