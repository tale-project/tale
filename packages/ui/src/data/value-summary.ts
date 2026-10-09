/**
 * A short account of a value, for a line in a list or a chip: its kind, a
 * few characters of a string or a number, a list's length and first items,
 * an object's key count and first names, and its size as JSON. Never the
 * whole value: a summary stays small however large the value is.
 */

import { stableStringify } from './stable-stringify';

export type ValueKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'array'
  | 'object';

export interface ValueSummary {
  /** `redacted` and `elided` are written by a recorder that withheld the
   *  value; {@link summaryOf} answers a {@link ValueKind}. */
  kind: ValueKind | 'redacted' | 'elided';
  /** At most {@link SUMMARY_TEXT_LENGTH} characters: a string (cut), a
   *  number (`NaN` and `Infinity` as text) or a boolean. */
  text?: string;
  /** A string's full length, or a list's. */
  length?: number;
  /** An object's key count, and its first {@link SUMMARY_KEY_NAMES} names,
   *  each cut to {@link SUMMARY_TEXT_LENGTH} characters. */
  keys?: number;
  names?: string[];
  /** A list's first {@link SUMMARY_ITEMS} items, summarized one level deep. */
  items?: ValueSummary[];
  /** The text was cut. */
  cut?: true;
  /** The value's size as JSON text, in UTF-8 bytes. */
  bytes?: number;
}

export const SUMMARY_TEXT_LENGTH = 80;
export const SUMMARY_KEY_NAMES = 8;
export const SUMMARY_ITEMS = 3;

const encoder = new TextEncoder();

/** What kind of value `value` is, as JSON would carry it. */
export function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'undefined';
  }
}

export function summaryOf(value: unknown): ValueSummary {
  const summary = shallowSummary(value);
  if (summary.kind === 'array' && Array.isArray(value)) {
    summary.items = value
      .slice(0, SUMMARY_ITEMS)
      .map((item: unknown) => shallowSummary(item));
  }
  if (summary.kind !== 'undefined') {
    summary.bytes = encoder.encode(stableStringify(value)).length;
  }
  return summary;
}

/** The summary of one value without its list items or size. */
function shallowSummary(value: unknown): ValueSummary {
  const kind = kindOf(value);
  switch (kind) {
    case 'string': {
      const text = String(value);
      return text.length > SUMMARY_TEXT_LENGTH
        ? {
            kind,
            text: cutText(text, SUMMARY_TEXT_LENGTH),
            length: text.length,
            cut: true,
          }
        : { kind, text, length: text.length };
    }
    case 'number':
    case 'boolean':
      return { kind, text: String(value) };
    case 'array':
      return { kind, length: Array.isArray(value) ? value.length : 0 };
    case 'object': {
      const names =
        typeof value === 'object' && value !== null ? Object.keys(value) : [];
      return {
        kind,
        keys: names.length,
        names: names
          .slice(0, SUMMARY_KEY_NAMES)
          .map((name) => cutText(name, SUMMARY_TEXT_LENGTH)),
      };
    }
    default:
      return { kind };
  }
}

/** The first `max` UTF-16 units of `text`, one fewer when the cut would
 * split a character that takes two (an emoji, a rare script). */
function cutText(text: string, max: number): string {
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}
