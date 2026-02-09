'use client';

import { useState, useCallback } from 'react';

import {
  parseImportFile,
  parseCSVWithMapper,
  type FileParseResult,
} from '@/lib/utils/file-parsing';

export interface UseFileImportOptions<T> {
  /** Function to map CSV rows to objects */
  csvMapper: (row: string[], index: number) => T | null;
  /** Function to map Excel records to objects */
  excelMapper: (record: Record<string, unknown>) => T | null;
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
}: UseFileImportOptions<T>): UseFileImportReturn<T> {
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseFile = useCallback(
    async (file: File): Promise<FileParseResult<T>> => {
      setIsParsing(true);
      setError(null);

      try {
        const result = await parseImportFile(file, csvMapper, excelMapper);

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
    [csvMapper, excelMapper],
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

/**
 * Customer import mapper utilities.
 */
export const customerMappers = {
  csv: (row: string[], _index: number) => {
    const email = row[0]?.trim();
    if (!email) return null;

    return {
      email,
      locale: row[1]?.trim() || 'en',
      status: 'churned' as const,
      source: 'manual_import' as const,
    };
  },
  excel: (record: Record<string, unknown>) => {
    const email =
      (record.email as string) ||
      (record.Email as string) ||
      (record.EMAIL as string);
    if (!email) return null;

    return {
      email,
      locale:
        (record.locale as string) ||
        (record.Locale as string) ||
        (record.LOCALE as string) ||
        'en',
      status: 'churned' as const,
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

    return {
      email,
      name: row[1]?.trim() || undefined,
      locale: row[2]?.trim() || 'en',
      source: 'manual_import' as const,
    };
  },
  excel: (record: Record<string, unknown>) => {
    const email =
      (record.email as string) ||
      (record.Email as string) ||
      (record.EMAIL as string);
    if (!email) return null;

    return {
      email,
      name:
        (record.name as string) ||
        (record.Name as string) ||
        (record.NAME as string) ||
        undefined,
      locale:
        (record.locale as string) ||
        (record.Locale as string) ||
        (record.LOCALE as string) ||
        'en',
      source: 'file_upload' as const,
    };
  },
};

/**
 * Product import mapper utilities.
 * Creates products with full field support including status, stock, currency, category.
 */
export const productMappers = {
  /** Helper to safely get string value */
  getString: (value: unknown): string | undefined => {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  },
  /** Helper to safely get number value */
  getNumber: (value: unknown): number | undefined => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  },
  /** Helper to validate product status */
  validateStatus: (
    value: unknown,
    validStatuses: readonly string[],
    defaultStatus: string,
  ): string => {
    if (typeof value !== 'string') return defaultStatus;
    const lowerValue = value.toLowerCase();
    return validStatuses.includes(lowerValue) ? lowerValue : defaultStatus;
  },
  csv: (row: string[], _index: number) => {
    const name = row[0]?.trim();
    if (!name) return null;

    return {
      name,
      sku: row[1]?.trim() || undefined,
      description: row[2]?.trim() || undefined,
      price: row[3] ? parseFloat(row[3]) : undefined,
      source: 'manual_import' as const,
    };
  },
  excel: (record: Record<string, unknown>) => {
    const getString = productMappers.getString;
    const getNumber = productMappers.getNumber;

    const name =
      getString(record.name) ||
      getString(record.Name) ||
      getString(record.NAME) ||
      getString(record.title) ||
      getString(record.Title);
    if (!name) return null;

    return {
      name,
      description:
        getString(record.description) || getString(record.Description),
      imageUrl:
        getString(record.imageUrl) ||
        getString(record.ImageUrl) ||
        getString(record.image_url) ||
        getString(record['image url']),
      stock: getNumber(record.stock) ?? getNumber(record.Stock) ?? 0,
      price: getNumber(record.price) ?? getNumber(record.Price) ?? 0,
      currency:
        getString(record.currency) || getString(record.Currency) || 'USD',
      category: getString(record.category) || getString(record.Category),
      status: record.status ?? record.Status,
    };
  },
};
