/**
 * Shared file parsing utilities for CSV and Excel files.
 * Used across import dialogs for customers, vendors, and products.
 */

import { isSpreadsheet } from '@/lib/shared/file-types';

/** A row the mapper refused, by the line the user sees in a spreadsheet
 * (the header is line 1, so the first data row is line 2). */
export type ImportRowError = { row: number; message: string };

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
  constructor(message: string) {
    super(message);
    this.name = 'ImportRowRefusal';
  }
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

type CSVParseOutput = {
  headers: string[] | null;
  rows: string[][];
};

/**
 * Parse a single CSV line respecting quoted fields (RFC 4180).
 * Handles commas, newlines, and escaped quotes inside quoted values.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  fields.push(current.trim());
  return fields;
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

  const lines = csvText.trim().split('\n');
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (skipEmptyLines && !trimmedLine) continue;

    const values = parseCSVLine(trimmedLine, delimiter);
    rows.push(values);
  }

  let headers: string[] | null = null;
  if (options.hasHeaders !== false && rows.length > 0) {
    headers = rows.shift()?.map((h) => h.toLowerCase()) ?? null;
  }

  return { headers, rows };
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
  const { headers, rows } = parseCSVText(csvText, {
    ...csvOptions,
    hasHeaders: !!recordMapper,
  });
  const result = emptyResult<T>();

  // Fail loudly when the header row is missing a required column, instead of
  // silently dropping rows or importing partial data (see #1312, #1323).
  if (recordMapper) {
    const missing = detectMissingColumns(headers, requiredColumns);
    if (missing.length > 0) {
      return emptyResult([missingColumnsError(missing, headers ?? [])]);
    }
  }

  const firstLine = headers ? 2 : 1;
  rows.forEach((row, index) => {
    const line = firstLine + index;
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
      result.rowErrors.push({
        row: line,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
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

/**
 * Parse an Excel file and return its rows with their lines.
 * Dynamically imports xlsx to reduce initial bundle size.
 */
async function parseExcelFile(file: File): Promise<ExcelRecord[]> {
  const XLSX = await import('xlsx');
  const buffer = await readFileAsArrayBuffer(file);
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return excelRecords(XLSX, worksheet);
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
      const records = await parseExcelFile(file);

      // Validate the header row (the keys of the first record) so a
      // mismatched schema fails loudly rather than dropping data silently.
      const headerKeys =
        records.length > 0 ? Object.keys(records[0].record) : [];
      const missing = detectMissingColumns(headerKeys, options.requiredColumns);
      if (missing.length > 0) {
        return emptyResult([missingColumnsError(missing, headerKeys)]);
      }

      const result = emptyResult<T>();
      records.forEach(({ record, line }) => {
        try {
          const mapped = excelMapper(record);
          if (mapped !== null) {
            result.data.push(mapped);
            result.rows.push(line);
          }
        } catch (error) {
          result.rowErrors.push({
            row: line,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
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
