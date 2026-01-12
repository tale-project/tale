/**
 * Build fetch parameters with resume point injection
 *
 * This module handles injecting resume points into fetch parameters
 * based on the find strategy.
 */

import type { CursorConfig, CursorFormat, FindStrategy } from '../types';
import { getNestedValue } from './get_nested_value';

/**
 * Resume point data retrieved from processing records
 */
export interface ResumePoint {
  /** The resume value (timestamp, cursor, or ID) */
  value: string | number | null;
  /** The strategy used to determine this resume point */
  strategy: string;
}

/**
 * Format a timestamp value for injection into fetch params
 */
function formatTimestampForParam(timestamp: number, format: CursorFormat): string | number {
  switch (format) {
    case 'iso':
      return new Date(timestamp).toISOString();
    case 'epoch_ms':
      return timestamp;
    case 'epoch_s':
      return Math.floor(timestamp / 1000);
    case 'date':
      return new Date(timestamp).toISOString().split('T')[0];
    default:
      return new Date(timestamp).toISOString();
  }
}

/**
 * Get the action parameter name to inject the cursor value
 * Defaults to cursor.field if actionParam is not specified
 */
function getActionParamName(cursorConfig: CursorConfig): string {
  return cursorConfig.actionParam ?? cursorConfig.field;
}

/**
 * Build fetch parameters with resume point injected
 *
 * Takes the original params and injects the resume point
 * based on the cursor configuration.
 *
 * @param params - Original fetch parameters
 * @param resumePoint - Resume point from previous processing
 * @param strategy - Find strategy being used
 * @param cursorConfig - Cursor configuration
 * @returns Updated fetch parameters with resume point injected
 */
export function buildFetchParams(
  params: Record<string, unknown> | undefined,
  resumePoint: ResumePoint | null,
  strategy: FindStrategy,
  cursorConfig: CursorConfig | undefined,
): Record<string, unknown> {
  const result = { ...params };

  // No resume point or no cursor config - return original params
  if (!resumePoint?.value || !cursorConfig) {
    return result;
  }

  const actionParamName = getActionParamName(cursorConfig);

  switch (strategy) {
    case 'find_by_timestamp': {
      const timestamp =
        typeof resumePoint.value === 'number'
          ? resumePoint.value
          : new Date(resumePoint.value).getTime();

      if (!isNaN(timestamp)) {
        const format = cursorConfig.format ?? 'iso';
        result[actionParamName] = formatTimestampForParam(timestamp, format);
      }
      break;
    }

    case 'find_by_cursor':
    case 'find_by_id':
      result[actionParamName] = resumePoint.value;
      break;

    case 'find_all':
      // No resume point injection for full scan
      break;
  }

  return result;
}

/**
 * Extract the next resume point from fetched records
 *
 * @param records - Array of fetched records
 * @param strategy - Find strategy being used
 * @param cursorConfig - Cursor configuration
 * @param currentCursor - Current cursor value (for find_by_cursor strategy)
 * @returns The next resume point value, or null if none
 */
export function extractNextResumePoint(
  records: Record<string, unknown>[],
  strategy: FindStrategy,
  cursorConfig: CursorConfig | undefined,
  currentCursor?: string | number | null,
): string | number | null {
  if (!cursorConfig || records.length === 0) {
    return null;
  }

  switch (strategy) {
    case 'find_by_timestamp': {
      let maxTimestamp: number | null = null;
      const format = cursorConfig.format ?? 'iso';

      for (const record of records) {
        const value = getNestedValue(record, cursorConfig.field);
        const timestamp = parseTimestamp(value, format);

        if (timestamp !== null && (maxTimestamp === null || timestamp > maxTimestamp)) {
          maxTimestamp = timestamp;
        }
      }

      return maxTimestamp;
    }

    case 'find_by_cursor':
      return currentCursor ?? null;

    case 'find_by_id': {
      let maxId: number | string | null = null;
      for (const record of records) {
        const value = getNestedValue(record, cursorConfig.field);

        if (typeof value === 'number') {
          if (maxId === null || value > (maxId as number)) {
            maxId = value;
          }
        } else if (typeof value === 'string') {
          if (maxId === null || value > (maxId as string)) {
            maxId = value;
          }
        }
      }

      return maxId;
    }

    case 'find_all':
      return null;
  }
}

/**
 * Parse a timestamp value into milliseconds
 */
function parseTimestamp(value: unknown, format: CursorFormat = 'iso'): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    // Check if it's seconds or milliseconds
    if (format === 'epoch_s') {
      return value * 1000;
    }
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}
