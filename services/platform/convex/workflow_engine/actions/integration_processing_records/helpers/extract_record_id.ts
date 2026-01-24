/**
 * Extract record ID from external data
 *
 * This module provides utilities for extracting unique record identifiers
 * from fetched external data based on configuration.
 */

import { getNestedValue } from './get_nested_value';

/**
 * Extract the record ID from a fetched record
 *
 * @param record - The fetched record object
 * @param recordIdField - The field path containing the record ID (supports dot notation)
 * @returns The record ID as a string, or null if not found
 *
 * @example
 * // Simple field
 * extractRecordId({ guest_id: 123 }, 'guest_id') // => '123'
 *
 * // Nested field
 * extractRecordId({ data: { id: 'abc' } }, 'data.id') // => 'abc'
 */
export function extractRecordId(
  record: Record<string, unknown>,
  recordIdField: string,
): string | null {
  const value = getNestedValue(record, recordIdField);

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  // For objects (e.g., MongoDB ObjectId), try toString
  if (typeof value === 'object') {
    const objValue = value as { toString?: () => string };
    if (typeof objValue.toString === 'function') {
      return objValue.toString();
    }
  }

  return null;
}
