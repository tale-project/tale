'use client';

import { useState, useCallback } from 'react';

import { isIso4217Currency } from '@/backend/core/products/field_limits';
import { CONTACT_LOCALE_PATTERN } from '@/lib/shared/schemas/common';
import {
  ImportRowRefusal,
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
        return { data: [], rows: [], errors: [errorMessage], rowErrors: [] };
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
        return { data: [], rows: [], errors: [errorMessage], rowErrors: [] };
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

/**
 * A product's count or amount from a cell — the create form's rule: blank
 * means "not given", and anything that is not a non-negative number within
 * the safe range is a row error the dialog lists in the reader's language,
 * never silently `0` (`notanumber` used to import as a free product).
 */
function productNumber(
  value: unknown,
  field: 'price' | 'stock',
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new ImportRowRefusal(field, 'notNumber');
  }
  if (parsed < 0) {
    throw new ImportRowRefusal(field, 'negative');
  }
  if (parsed > Number.MAX_SAFE_INTEGER) {
    throw new ImportRowRefusal(field, 'tooLarge');
  }
  if (field === 'stock' && !Number.isInteger(parsed)) {
    throw new ImportRowRefusal(field, 'notInteger');
  }
  return parsed;
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
 * Required columns for contact imports. Email is the only hard
 * requirement; a file whose header row has no email-like column is rejected
 * with a clear error instead of importing partial/empty data.
 */
export const CONTACT_REQUIRED_COLUMNS: RequiredColumn[] = [
  { label: 'email', aliases: EMAIL_HEADER_ALIASES },
];

/**
 * Contact import mapper utilities — shared by the contacts manual-entry
 * (paste) and file-upload paths. Locale is left `undefined` when the file
 * doesn't provide one; the server stores no locale rather than fabricating
 * `'en'` for a value nobody chose (#2642).
 */
export const contactMappers = {
  /** The positional (header-less) fallback; a row without an email is
   * skipped, as the paste lane always did. */
  csv: (row: string[], _index: number) => {
    const email = row[0]?.trim();
    if (!email) return null;

    const second = row[1]?.trim();
    const third = row[2]?.trim();
    const isLocale = (value?: string) =>
      !!value && CONTACT_LOCALE_PATTERN.test(value);

    return {
      email,
      name: third
        ? second || undefined
        : isLocale(second)
          ? undefined
          : second || undefined,
      locale: third || (isLocale(second) ? second : undefined),
      source: 'manual_import' as const,
    };
  },
  /** The header-mapped lane (CSV with headers, Excel): a row without an
   * email is a row error the dialog lists, not a row that vanishes. */
  excel: (record: Record<string, unknown>) => {
    const email = pickField(record, EMAIL_HEADER_ALIASES);
    if (!email) throw new ImportRowRefusal('email', 'blank');

    return {
      email,
      name: pickField(record, NAME_HEADER_ALIASES),
      locale: pickField(record, LOCALE_HEADER_ALIASES),
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
  /** A blank status takes the default; an unknown one (`flying`) is a row
   * error, never silently the default. */
  validateStatus: <T extends string>(
    value: unknown,
    validStatuses: readonly T[],
    defaultStatus: T,
  ): T => {
    if (typeof value !== 'string' || value.trim() === '') return defaultStatus;
    const lowerValue = value.trim().toLowerCase();
    const match = validStatuses.find((s) => s === lowerValue);
    if (match === undefined) {
      throw new ImportRowRefusal('status', 'notOneOf', {
        options: validStatuses.join(', '),
      });
    }
    return match;
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
  /** Record-based mapper used by both CSV (with headers) and Excel imports.
   * A row the catalog would refuse — no name, a price or stock that is not a
   * number, a currency that is not ISO 4217 — is a row error carrying its
   * field and reason keys, so the dialog lists it by line, translated. */
  record: (record: Record<string, unknown>) => {
    const name = getString(record.name) || getString(record.title);
    if (!name) throw new ImportRowRefusal('name', 'blank');
    const currency = getString(record.currency);
    if (currency !== undefined && !isIso4217Currency(currency.toUpperCase())) {
      throw new ImportRowRefusal('currency', 'notCurrency');
    }

    return {
      name,
      description: getString(record.description),
      imageUrl:
        getString(record.imageurl) ||
        getString(record.image_url) ||
        getString(record['image url']),
      stock: productNumber(record.stock, 'stock') ?? 0,
      price: productNumber(record.price, 'price') ?? 0,
      currency: currency?.toUpperCase() ?? 'USD',
      category: getString(record.category),
      status: record.status,
    };
  },
};
