/**
 * Shared file parsing utilities for CSV and Excel files.
 * Used across import dialogs for customers, vendors, and products.
 */

export type FileParseResult<T> = {
  data: T[];
  errors: string[];
};

type CSVParseOptions = {
  /** Column delimiter (default: comma) */
  delimiter?: string;
  /** Whether the first row contains headers (default: false) */
  hasHeaders?: boolean;
  /** Skip empty lines (default: true) */
  skipEmptyLines?: boolean;
};

/**
 * Parse CSV text into rows of string arrays.
 */
function parseCSVText(
  csvText: string,
  options: CSVParseOptions = {}
): string[][] {
  const { delimiter = ',', skipEmptyLines = true } = options;

  const lines = csvText.trim().split('\n');
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (skipEmptyLines && !trimmedLine) continue;

    const values = trimmedLine.split(delimiter).map((item) => item.trim());
    rows.push(values);
  }

  return rows;
}

/**
 * Parse CSV text with a mapper function to transform rows into typed objects.
 */
export function parseCSVWithMapper<T>(
  csvText: string,
  mapper: (row: string[], index: number) => T | null,
  options: CSVParseOptions = {}
): FileParseResult<T> {
  const rows = parseCSVText(csvText, options);
  const data: T[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    try {
      const mapped = mapper(row, index);
      if (mapped !== null) {
        data.push(mapped);
      }
    } catch (error) {
      errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  return { data, errors };
}

/**
 * Read a file as text.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Read a file as ArrayBuffer (for Excel files).
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (result instanceof ArrayBuffer) {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse an Excel file and return the data as array of records.
 * Dynamically imports xlsx to reduce initial bundle size.
 */
async function parseExcelFile(
  file: File
): Promise<Array<Record<string, unknown>>> {
  const XLSX = await import('xlsx');
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(worksheet);
}

/**
 * Check if a file is a CSV file based on extension.
 */
function isCSVFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.csv');
}

/**
 * Check if a file is an Excel file based on extension.
 */
function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.xlsx') || name.endsWith('.xls');
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
  excelMapper: (record: Record<string, unknown>) => T | null
): Promise<FileParseResult<T>> {
  const errors: string[] = [];
  const data: T[] = [];

  try {
    if (isCSVFile(file)) {
      const text = await readFileAsText(file);
      const result = parseCSVWithMapper(text, csvMapper);
      return result;
    } else if (isExcelFile(file)) {
      const records = await parseExcelFile(file);
      records.forEach((record, index) => {
        try {
          const mapped = excelMapper(record);
          if (mapped !== null) {
            data.push(mapped);
          }
        } catch (error) {
          errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      });
      return { data, errors };
    } else {
      return {
        data: [],
        errors: ['Unsupported file format. Please use CSV or Excel files.'],
      };
    }
  } catch (error) {
    return {
      data: [],
      errors: [error instanceof Error ? error.message : 'Failed to parse file'],
    };
  }
}

/**
 * Get a value from an Excel record with case-insensitive key matching.
 */
function getExcelValue<T = string>(
  record: Record<string, unknown>,
  ...keys: string[]
): T | undefined {
  for (const key of keys) {
    // Try exact match first
    if (key in record) {
      return record[key] as T;
    }
    // Try lowercase match
    const lowerKey = key.toLowerCase();
    for (const recordKey of Object.keys(record)) {
      if (recordKey.toLowerCase() === lowerKey) {
        return record[recordKey] as T;
      }
    }
  }
  return undefined;
}
