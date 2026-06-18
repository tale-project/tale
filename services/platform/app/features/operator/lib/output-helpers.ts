/**
 * Defensive readers for the untyped `step.output` payload. Pack outputs are
 * data-shaped (not statically typed here), so every panel reads through these
 * guards and falls back gracefully when a field is absent or the wrong type.
 */
import { isRecord } from '@/lib/utils/type-utils';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** First array-valued field among `keys`, else []. */
export function pickArray(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): unknown[] {
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

/** First number-valued field among `keys`, else undefined. */
export function pickNumber(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number') return value;
  }
  return undefined;
}

/** First string-valued field among `keys`, else undefined. */
export function pickString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** A short scalar rendering for table/list cells. */
export function scalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? '—';
}
