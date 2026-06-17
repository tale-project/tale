'use node';

/**
 * XLSX text extraction using SheetJS.
 *
 * Converts spreadsheet rows into plain text for indexing.
 */

import * as XLSX from 'xlsx';

/** Render a SheetJS cell value (string/number/boolean/Date/null) as text. */
function stringifyCell(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return '';
  }
  if (typeof cell === 'string') {
    return cell;
  }
  if (
    typeof cell === 'number' ||
    typeof cell === 'boolean' ||
    typeof cell === 'bigint'
  ) {
    return cell.toString();
  }
  if (cell instanceof Date) {
    return cell.toISOString();
  }
  return '';
}

/**
 * Extract text from XLSX bytes. Returns `[text, visionUsed]`; vision is never
 * used for spreadsheets. Throws on an invalid/corrupt workbook.
 */
export async function extractTextFromXlsxBytes(
  xlsxBytes: Uint8Array,
  _filename = 'spreadsheet.xlsx',
): Promise<[string, boolean]> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(xlsxBytes, { type: 'array' });
  } catch (err) {
    throw new Error('Invalid or corrupt file', { cause: err });
  }

  const sheetsText: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
    });

    const rowsText: string[] = [];
    for (const row of rows) {
      const cells = row.map(stringifyCell);
      if (!cells.some((cell) => cell.trim().length > 0)) {
        continue;
      }
      const line = cells.join(' | ').trim();
      if (line) {
        rowsText.push(line);
      }
    }

    if (rowsText.length > 0) {
      sheetsText.push(`--- Sheet: ${sheetName} ---\n${rowsText.join('\n')}`);
    }
  }

  return [sheetsText.join('\n\n'), false];
}
