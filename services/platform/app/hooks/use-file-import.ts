'use client';

import { useState, useCallback } from 'react';

import {
  parseImportFile,
  parseCSVWithMapper,
  type FileParseResult,
  type RequiredColumn,
} from '@/lib/utils/file-parsing';

export interface UseFileImportOptions<T> {
  /** Function to map CSV rows to objects */
  csvMapper: (row: string[], index: number) => T | null;
  /** Function to map Excel records to objects */
  excelMapper: (record: Record<string, unknown>) => T | null;
  /**
   * Columns the uploaded file's header row must contain. When provided, a
   * file/CSV whose headers are missing a required column fails with a clear
   * error rather than silently dropping rows.
   */
  requiredColumns?: RequiredColumn[];
}

export interface UseFileImportReturn<T> {
  /** Parse a file and return the results */
  parseFile: (file: File) => Promise<FileParseResult<T>>;
  /** Parse CSV text and return the results */
  parseCSV: (csvText: string) => FileParseResult<T>;
  /** Whether a parse operation is in progress */
  isParsing: boolean;
  /** The last parse error, if any */
  error: string | null;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Hook for importing data from CSV or Excel files.
 * Provides a consistent interface for file parsing with loading and error states.
 *
 * @example
 * ```tsx
 * const { parseFile, parseCSV, isParsing } = useFileImport({
 *   csvMapper: (row) => ({
 *     email: row[0],
 *     name: row[1],
 *   }),
 *   excelMapper: (record) => ({
 *     email: record.email || record.Email,
 *     name: record.name || record.Name,
 *   }),
 * });
 *
 * // Parse a file
 * const result = await parseFile(file);
 *
 * // Parse CSV text
 * const result = parseCSV(csvText);
 * ```
 */
export function useFileImport<T>({
  csvMapper,
  excelMapper,
  requiredColumns,
}: UseFileImportOptions<T>): UseFileImportReturn<T> {
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseFile = useCallback(
    async (file: File): Promise<FileParseResult<T>> => {
      setIsParsing(true);
      setError(null);

      try {
        const result = await parseImportFile(file, csvMapper, excelMapper, {
          requiredColumns,
        });

        if (result.errors.length > 0 && result.data.length === 0) {
          setError(result.errors[0]);
        }

        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to parse file';
        setError(errorMessage);
        return { data: [], errors: [errorMessage] };
      } finally {
        setIsParsing(false);
      }
    },
    [csvMapper, excelMapper, requiredColumns],
  );

  const parseCSV = useCallback(
    (csvText: string): FileParseResult<T> => {
      setError(null);

      try {
        const result = parseCSVWithMapper(csvText, csvMapper);

        if (result.errors.length > 0 && result.data.length === 0) {
          setError(result.errors[0]);
        }

        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to parse CSV';
        setError(errorMessage);
        return { data: [], errors: [errorMessage] };
      }
    },
    [csvMapper],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    parseFile,
    parseCSV,
    isParsing,
    error,
    clearError,
  };
}

// Common mappers for reuse

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// Accepted (lowercase) header spellings for contact imports. Headers are
// already lowercased/trimmed by the parser, so a file with "Email Address"
// or "Company" maps correctly instead of silently dropping the field.
const EMAIL_HEADER_ALIASES = [
  'email',
  'e-mail',
  'emailaddress',
  'email address',
  'e-mail address',
  'mail',
];
const NAME_HEADER_ALIASES = [
  'name',
  'full name',
  'fullname',
  'display name',
  'contact',
  'contact name',
  'company',
  'company name',
  'vendor name',
  'customer name',
];
const LOCALE_HEADER_ALIASES = ['locale', 'language', 'lang'];

/** Return the first non-empty value among the given header aliases. */
function pickField(
  record: Record<string, unknown>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const value = getString(record[alias]);
    if (value) return value;
  }
  return undefined;
}

/**
 * Required columns for customer/vendor imports. Email is the only hard
 * requirement; a file whose header row has no email-like column is rejected
 * with a clear error instead of importing partial/empty data.
 */
export const CONTACT_REQUIRED_COLUMNS: RequiredColumn[] = [
  { label: 'email', aliases: EMAIL_HEADER_ALIASES },
];

/**
 * Customer import mapper utilities.
 */
export const customerMappers = {
  csv: (row: string[], _index: number) => {
    const email = row[0]?.trim();
    if (!email) return null;

    const second = row[1]?.trim();
    const third = row[2]?.trim();
    const isLocale = (value?: string) =>
      !!value && /^[a-z]{2}(?:-[A-Z]{2})?$/i.test(value);

    return {
      email,
      name: third
        ? second || undefined
        : isLocale(second)
          ? undefined
          : second || undefined,
      locale: third || (isLocale(second) ? second : undefined) || 'en',
      status: 'active' as const,
      source: 'manual_import' as const,
    };
  },
  excel: (record: Record<string, unknown>) => {
    const email = pickField(record, EMAIL_HEADER_ALIASES);
    if (!email) return null;

    return {
      email,
      name: pickField(record, NAME_HEADER_ALIASES),
      locale: pickField(record, LOCALE_HEADER_ALIASES) || 'en',
      status: 'active' as const,
      source: 'file_upload' as const,
    };
  },
};

/**
 * Vendor import mapper utilities.
 */
export const vendorMappers = {
  csv: (row: string[], _index: number) => {
    const email = row[0]?.trim();
    if (!email) return null;

    const second = row[1]?.trim();
    const third = row[2]?.trim();
    const isLocale = (value?: string) =>
      !!value && /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/i.test(value);

    return {
      email,
      name: third
        ? second || undefined
        : isLocale(second)
          ? undefined
          : second || undefined,
      locale: third || (isLocale(second) ? second : undefined) || 'en',
      source: 'manual_import' as const,
    };
  },
  excel: (record: Record<string, unknown>) => {
    const email = pickField(record, EMAIL_HEADER_ALIASES);
    if (!email) return null;

    return {
      email,
      name: pickField(record, NAME_HEADER_ALIASES),
      locale: pickField(record, LOCALE_HEADER_ALIASES) || 'en',
      source: 'file_upload' as const,
    };
  },
};

// Accepted (lowercase) header spellings for the product columns that gate a
// valid import. `name` mirrors the record mapper's name/title fallback.
const PRODUCT_NAME_HEADER_ALIASES = ['name', 'title'];

/**
 * Required columns for product imports. A file whose header row is missing the
 * product name, price, or stock column is rejected with a clear error instead
 * of silently importing misaligned data or zero-filled defaults (see #1308).
 * Optional columns (description, imageUrl, currency, category, status) keep
 * their per-field defaults and are not gated here.
 */
export const PRODUCT_REQUIRED_COLUMNS: RequiredColumn[] = [
  { label: 'name', aliases: PRODUCT_NAME_HEADER_ALIASES },
  { label: 'price', aliases: ['price'] },
  { label: 'stock', aliases: ['stock'] },
];

/**
 * Product import mapper utilities.
 * Creates products with full field support including status, stock, currency, category.
 */
export const productMappers = {
  getString,
  getNumber,
  /** Helper to validate product status */
  validateStatus: <T extends string>(
    value: unknown,
    validStatuses: readonly T[],
    defaultStatus: T,
  ): T => {
    if (typeof value !== 'string') return defaultStatus;
    const lowerValue = value.toLowerCase();
    return validStatuses.find((s) => s === lowerValue) ?? defaultStatus;
  },
  /** Expected header names for product imports */
  expectedHeaders: [
    'name',
    'description',
    'imageurl',
    'stock',
    'price',
    'currency',
    'category',
    'status',
  ] as const,
  /**
   * CSV fallback mapper — only runs when headers are NOT detected.
   * Returns null for every row so the import fails with a clear error
   * instead of silently misaligning columns by position.
   */
  csv: (_row: string[], _index: number) => {
    return null;
  },
  /** Record-based mapper used by both CSV (with headers) and Excel imports */
  record: (record: Record<string, unknown>) => {
    const name = getString(record.name) || getString(record.title);
    if (!name) return null;

    return {
      name,
      description: getString(record.description),
      imageUrl:
        getString(record.imageurl) ||
        getString(record.image_url) ||
        getString(record['image url']),
      stock: getNumber(record.stock) ?? 0,
      price: getNumber(record.price) ?? 0,
      currency: getString(record.currency) || 'USD',
      category: getString(record.category),
      status: record.status,
    };
  },
};
