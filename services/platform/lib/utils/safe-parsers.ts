/**
 * Safe parsing utilities for metadata, JSON, and complex data structures.
 *
 * These functions prevent runtime errors from malformed or unexpected data
 * by providing type-safe extraction with fallback values.
 *
 * Used primarily in:
 * - Approvals metadata parsing
 * - Complex table cell renderers
 * - API response handling
 *
 * @example
 * const metadata = approval.metadata as unknown;
 * const customerName = safeGetString(metadata, 'customerName', 'Unknown');
 * const products = safeParseProductList(metadata.recommendedProducts);
 */

import { isRecord } from './type-guards';

/**
 * Safely extract a string value from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback value if extraction fails
 * @returns The string value or fallback
 */
export function safeGetString(
  obj: unknown,
  key: string,
  fallback = '',
): string {
  if (!isRecord(obj)) return fallback;
  const value = obj[key];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Safely extract a number value from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback value if extraction fails
 * @returns The number value or fallback
 */
export function safeGetNumber(
  obj: unknown,
  key: string,
  fallback?: number,
): number | undefined {
  if (!isRecord(obj)) return fallback;
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Safely extract an array from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback array if extraction fails
 * @returns The array value or fallback
 */
export function safeGetArray<T>(
  obj: unknown,
  key: string,
  fallback: T[] = [],
): T[] {
  if (!isRecord(obj)) return fallback;
  const value = obj[key];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Array.isArray narrows to unknown[]; T[] not inferrable
  return Array.isArray(value) ? (value as T[]) : fallback;
}
