/**
 * Shared file parsing utilities for CSV and Excel files.
 * Used across import dialogs for customers, vendors, and products.
 */

import { isSpreadsheet } from '@/lib/shared/file-types';

/** The columns a record mapper can refuse — each a label key under
 * `common.import.fields`. */
export const IMPORT_ROW_FIELDS = [
  'name',
  'price',
  'stock',
  'currency',
  'status',
  'email',
] as const;
export type ImportRowField = (typeof IMPORT_ROW_FIELDS)[number];

/** Why a record mapper refused a cell — each a sentence key under
 * `common.import.reasons`, taking `{field}` plus the listed values. */
export const IMPORT_ROW_REASONS = [
  'blank',
  'notNumber',
  'negative',
  'tooLarge',
  'notInteger',
  'notCurrency',
  'notOneOf',
] as const;
export type ImportRowReason = (typeof IMPORT_ROW_REASONS)[number];

/** A row the mapper refused, by the line the user sees in a spreadsheet
 * (the header is line 1, so the first data row is line 2). The parser's own
 * refusals carry an i18n `field` + `reason` the dialog translates, or
 * `quotes: 'unpaired'` for a CSV row whose quotes don't pair up; a row the
 * server refused carries the server's text as `message`. */
export type ImportRowError =
  | { row: number; message: string }
  | { row: number; quotes: 'unpaired' }
  | {
      row: number;
      field: ImportRowField;
      reason: ImportRowReason;
      values?: Record<string, string | number>;
    };

export type FileParseResult<T> = {
  data: T[];
  /** The spreadsheet line each `data` entry came from, by position — what
   * maps a server's per-row refusal (`errors[].index`) back to the file. */
  rows: number[];
  /** File-level failures: format, a missing required column. */
  errors: string[];
  /** Rows the mapper refused; the rest of the file still parsed. */
  rowErrors: ImportRowError[];
};

/** A refused row, thrown by a record mapper; the parser files it under the
 * row's own line instead of dropping the row or the whole file. */
export class ImportRowRefusal extends Error {
  readonly field: ImportRowField;
  readonly reason: ImportRowReason;
  readonly values: Record<string, string | number> | undefined;

  constructor(
    field: ImportRowField,
    reason: ImportRowReason,
    values?: Record<string, string | number>,
  ) {
    super(`${field}: ${reason}`);
    this.name = 'ImportRowRefusal';
    this.field = field;
    this.reason = reason;
    this.values = values;
  }

  /** The row error the parser files, at the given spreadsheet line. */
  toRowError(row: number): ImportRowError {
    return {
      row,
      field: this.field,
      reason: this.reason,
      ...(this.values ? { values: this.values } : {}),
    };
  }
}

/** A cell nobody filled: missing, or a string of nothing but whitespace. */
function isBlankCell(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  );
}

/** A row of nothing but blank cells (`,,,,`) — a spreadsheet's trailing
 * lines, never a record the mapper should refuse. */
function isBlankRecord(cells: Iterable<unknown>): boolean {
  for (const cell of cells) {
    if (!isBlankCell(cell)) return false;
  }
  return true;
}

/** The row error for whatever a mapper threw at the given line. */
function refusedRow(row: number, error: unknown): ImportRowError {
  if (error instanceof ImportRowRefusal) return error.toRowError(row);
  return {
    row,
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}

function emptyResult<T>(errors: string[] = []): FileParseResult<T> {
  return { data: [], rows: [], errors, rowErrors: [] };
}

/**
 * A column the import file must contain. `label` is the canonical name shown
 * to the user; `aliases` are the accepted (case-insensitive) header spellings.
 */
export type RequiredColumn = { label: string; aliases: string[] };

/**
 * Returns the labels of required columns that are absent from `headers`.
 * A column counts as present when any of its aliases matches a header.
 * Returns [] when there is nothing to validate (no headers / no requirements).
 */
function detectMissingColumns(
  headers: string[] | null,
  required?: RequiredColumn[],
): string[] {
  if (!required || required.length === 0 || !headers) return [];
  const present = new Set(headers.map((h) => h.trim().toLowerCase()));
  return required
    .filter((col) => !col.aliases.some((a) => present.has(a.toLowerCase())))
    .map((col) => col.label);
}

function missingColumnsError(missing: string[], headers: string[]): string {
  const found = headers.length > 0 ? headers.join(', ') : '(none)';
  return `Missing required column(s): ${missing.join(', ')}. Found columns: ${found}.`;
}

type CSVParseOptions = {
  /** Column delimiter (default: comma) */
  delimiter?: string;
  /** Skip empty lines (default: true) */
  skipEmptyLines?: boolean;
  /** Whether the first row contains column headers (default: true) */
  hasHeaders?: boolean;
};

/** One CSV record: its trimmed fields, whether its quotes failed to pair up
 * (a quoted field never closed, or text after a closing quote), and its
 * spreadsheet row. */
type CSVRecord = {
  values: string[];
  unpairedQuotes: boolean;
  /** 1-based; every record is one row — a blank line, and a quoted cell
   * across line breaks (LF or CRLF), count one row each. */
  line: number;
};

type CSVParseOutput = {
  headers: string[] | null;
  /** The header record's row, when headers are present. */
  headerLine: number | null;
  /** The header record's quotes failed to pair up. */
  headerUnpairedQuotes: boolean;
  rows: CSVRecord[];
};

/**
 * Split CSV text into records of trimmed fields (RFC 4180). A record is not
 * a physical line: a quoted field holds the delimiter, `""` for a quote and
 * line breaks, which is how a spreadsheet exports a cell with a line break.
 * A quote opens a quoted field only at the start of a field; inside one
 * (`6" long`) it is a literal character. A quote that never closes is read as
 * a literal character too, so an unbalanced quote cannot swallow the records
 * after it, and its record, like one with text after a closing quote, is
 * marked `unpairedQuotes`. Records end at `\n` (a CRLF's `\r` is trimmed with
 * its field); a blank line is a record of one blank field.
 */
function parseCSVRecords(text: string, delimiter: string): CSVRecord[] {
  const records: CSVRecord[] = [];
  let fields: string[] = [];
  let field = '';
  // Only whitespace read into the field so far: a quote here opens it.
  let atFieldStart = true;
  // The field's quoted part has closed: only whitespace may follow it.
  let quoteClosed = false;
  let unpairedQuotes = false;
  let recordStart = 0;
  // The open quoted field: where its quote is and what the field held before.
  let quote: { at: number; before: string } | null = null;
  let i = 0;

  const endField = () => {
    fields.push(field.trim());
    field = '';
    atFieldStart = true;
    quoteClosed = false;
  };
  const endRecord = (next: number) => {
    endField();
    // Rows are counted by record, not by line break: the breaks inside a
    // quoted cell belong to the cell, as in the spreadsheet it came from.
    records.push({ values: fields, unpairedQuotes, line: records.length + 1 });
    fields = [];
    unpairedQuotes = false;
    recordStart = next;
  };

  while (i < text.length || quote) {
    if (i === text.length && quote) {
      // The text ended inside quotes: read that quote as a literal
      // character, and what follows it again, unquoted.
      field = `${quote.before}"`;
      // No record ended inside the quotes, so the replayed records keep
      // their rows.
      i = quote.at + 1;
      quote = null;
      unpairedQuotes = true;
      continue;
    }
    const char = text[i];
    if (quote) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quote = null;
        quoteClosed = true;
      }
      i++;
    } else if (char === '"' && atFieldStart) {
      quote = { at: i, before: field };
      atFieldStart = false;
      i++;
    } else if (char === delimiter) {
      endField();
      i++;
    } else if (char === '\n') {
      endRecord(i + 1);
      i++;
    } else {
      field += char;
      if ((atFieldStart || quoteClosed) && char.trim() !== '') {
        // Text after a closing quote leaves the field's quotes unpaired.
        if (quoteClosed) unpairedQuotes = true;
        atFieldStart = false;
      }
      i++;
    }
  }
  // A last line without a line break is a record too.
  if (recordStart < text.length) endRecord(text.length);
  return records;
}

/** A record of one blank field: an empty or whitespace-only line. */
function isBlankLine({ values }: CSVRecord): boolean {
  return values.length === 1 && values[0] === '';
}

/**
 * Parse CSV text into rows of string arrays.
 * Automatically detects header rows and returns them separately.
 * Handles quoted fields per RFC 4180.
 */
function parseCSVText(
  csvText: string,
  options: CSVParseOptions = {},
): CSVParseOutput {
  const { delimiter = ',', skipEmptyLines = true } = options;

  const rows: CSVRecord[] = [];

  for (const record of parseCSVRecords(csvText, delimiter)) {
    if (skipEmptyLines && isBlankLine(record)) continue;
    rows.push(record);
  }

  let headers: string[] | null = null;
  let headerUnpairedQuotes = false;
  const header = options.hasHeaders !== false ? rows.shift() : undefined;
  if (header) {
    headers = header.values.map((h) => h.toLowerCase());
    headerUnpairedQuotes = header.unpairedQuotes;
  }

  return {
    headers,
    headerLine: header?.line ?? null,
    headerUnpairedQuotes,
    rows,
  };
}

/**
 * Parse CSV text with a mapper function to transform rows into typed objects.
 * When headers are detected, rows are converted to named records and passed
 * through the optional recordMapper for accurate column mapping.
 */
export function parseCSVWithMapper<T>(
  csvText: string,
  mapper: (row: string[], index: number) => T | null,
  options: CSVParseOptions & {
    recordMapper?: (record: Record<string, unknown>) => T | null;
    /** When set (header mode), the parse fails loudly if a required column is absent. */
    requiredColumns?: RequiredColumn[];
  } = {},
): FileParseResult<T> {
  const { recordMapper, requiredColumns, ...csvOptions } = options;
  const { headers, headerLine, headerUnpairedQuotes, rows } = parseCSVText(
    csvText,
    {
      ...csvOptions,
      hasHeaders: !!recordMapper,
    },
  );
  const result = emptyResult<T>();

  // A header whose quotes don't pair up names no column reliably: refuse the
  // file at the header's row instead of importing under misread headers.
  if (headerUnpairedQuotes) {
    result.rowErrors.push({ row: headerLine ?? 1, quotes: 'unpaired' });
    return result;
  }

  // Fail loudly when the header row is missing a required column, instead of
  // silently dropping rows or importing partial data (see #1312, #1323).
  if (recordMapper) {
    const missing = detectMissingColumns(headers, requiredColumns);
    if (missing.length > 0) {
      return emptyResult([missingColumnsError(missing, headers ?? [])]);
    }
  }

  rows.forEach(({ values: row, unpairedQuotes, line }, index) => {
    // `,,,,` is not a record: skipped like an empty line, never refused.
    if (isBlankRecord(row)) return;
    // A row whose quotes don't pair up may hold misread cells: refused.
    if (unpairedQuotes) {
      result.rowErrors.push({ row: line, quotes: 'unpaired' });
      return;
    }
    try {
      let mapped: T | null;
      if (headers && recordMapper) {
        const record: Record<string, unknown> = {};
        headers.forEach((header, i) => {
          record[header] = row[i] ?? '';
        });
        mapped = recordMapper(record);
      } else {
        mapped = mapper(row, index);
      }
      if (mapped !== null) {
        result.data.push(mapped);
        result.rows.push(line);
      }
    } catch (error) {
      result.rowErrors.push(refusedRow(line, error));
    }
  });

  return result;
}

/**
 * Read a file as text.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    });
    reader.addEventListener('error', () =>
      reject(new Error('Failed to read file')),
    );
    reader.readAsText(file);
  });
}

/**
 * Read a file as ArrayBuffer (for Excel files).
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', (e) => {
      const result = e.target?.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    });
    reader.addEventListener('error', () =>
      reject(new Error('Failed to read file')),
    );
    reader.readAsArrayBuffer(file);
  });
}

/** One data row of a sheet: its record (header keys lower-cased) and the
 * spreadsheet line it sits on — the one-based row number a person sees. */
export interface ExcelRecord {
  record: Record<string, unknown>;
  line: number;
}

/**
 * The records of a worksheet with the line each one came from. SheetJS
 * skips blank rows, so a record's index is not its row: an import error
 * reported as `index + 2` named the wrong line once a blank row sat above
 * it. Every object `sheet_to_json` answers carries the sheet's own
 * zero-based row index as `__rowNum__`, so the line is read from that.
 */
export function excelRecords(
  XLSX: typeof import('xlsx'),
  worksheet: import('xlsx').WorkSheet,
): ExcelRecord[] {
  const rows = XLSX.utils.sheet_to_json<
    Record<string, unknown> & { __rowNum__?: number }
  >(worksheet);
  return rows.map((row, index) => ({
    record: Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.trim().toLowerCase(),
        value,
      ]),
    ),
    // `__rowNum__` is non-enumerable, so it never lands in the record; the
    // index fallback (header + 1) is for a build without it.
    line: (row.__rowNum__ ?? index + 1) + 1,
  }));
}

/** Convert a worksheet header cell to its textual column name safely. */
export function excelHeaderText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    const text = (value as { text?: unknown; w?: unknown }).text;
    if (typeof text === 'string') return text;
    const formatted = (value as { text?: unknown; w?: unknown }).w;
    if (typeof formatted === 'string') return formatted;
  }
  return '';
}

/**
 * Parse an Excel file and return its rows with their lines.
 * Dynamically imports xlsx to reduce initial bundle size.
 */
async function parseExcelFile(
  file: File,
): Promise<{ headers: string[]; records: ExcelRecord[] }> {
  const XLSX = await import('xlsx');
  const buffer = await readFileAsArrayBuffer(file);
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    range: 0,
    blankrows: false,
  });
  const headers = (headerRows[0] ?? []).map((header) =>
    excelHeaderText(header).trim().toLowerCase(),
  );
  return { headers, records: excelRecords(XLSX, worksheet) };
}

function isCSVFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.csv');
}

function isExcelFile(file: File): boolean {
  return isSpreadsheet(file.name) && !isCSVFile(file);
}

/**
 * Generic file parser that handles both CSV and Excel files.
 * @param file - The file to parse
 * @param csvMapper - Function to map CSV rows to objects
 * @param excelMapper - Function to map Excel records to objects
 */
export async function parseImportFile<T>(
  file: File,
  csvMapper: (row: string[], index: number) => T | null,
  excelMapper: (record: Record<string, unknown>) => T | null,
  options: { requiredColumns?: RequiredColumn[] } = {},
): Promise<FileParseResult<T>> {
  try {
    if (isCSVFile(file)) {
      const text = await readFileAsText(file);
      const result = parseCSVWithMapper(text, csvMapper, {
        recordMapper: excelMapper,
        requiredColumns: options.requiredColumns,
      });
      return result;
    } else if (isExcelFile(file)) {
      const { headers: headerKeys, records } = await parseExcelFile(file);

      // Validate the header row (the keys of the first record) so a
      // mismatched schema fails loudly rather than dropping data silently.
      const missing = detectMissingColumns(headerKeys, options.requiredColumns);
      if (missing.length > 0) {
        return emptyResult([missingColumnsError(missing, headerKeys)]);
      }

      const result = emptyResult<T>();
      records.forEach(({ record, line }) => {
        if (isBlankRecord(Object.values(record))) return;
        try {
          const mapped = excelMapper(record);
          if (mapped !== null) {
            result.data.push(mapped);
            result.rows.push(line);
          }
        } catch (error) {
          result.rowErrors.push(refusedRow(line, error));
        }
      });
      return result;
    } else {
      return emptyResult([
        'Unsupported file format. Please use CSV or Excel files.',
      ]);
    }
  } catch (error) {
    return emptyResult([
      error instanceof Error ? error.message : 'Failed to parse file',
    ]);
  }
}
