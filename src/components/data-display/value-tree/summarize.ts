import type { TFunction } from 'i18next';

import { kindOf, type ValueSummary } from '../../../data/value-summary';
import { formatBytes } from '../../../lib/format';

/**
 * A value in words, for a sentence, a chip or a row's accessible name:
 * "a list of 12 items", "“Fix login”", "250", "empty". Every function takes
 * the `t` of the `valueTree` namespace, so a host words values in its
 * reader's language with the package's own catalog.
 */

export interface SummarizeOptions {
  /** Text longer than this is not quoted whole: 80 characters. */
  maxChars?: number;
  /** Writes numbers and sizes: the reader's language. */
  locale?: string;
}

const DEFAULT_MAX_CHARS = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first `max` UTF-16 units of `text`, one fewer when the cut would
 *  split a character that takes two. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

const separators = new Map<string, { minus: string; decimal: string }>();
const groupings = new Map<string, Intl.NumberFormat>();

function numberParts(locale: string): { minus: string; decimal: string } {
  let parts = separators.get(locale);
  if (parts === undefined) {
    const sample = new Intl.NumberFormat(locale).formatToParts(-1.5);
    parts = {
      minus: sample.find((part) => part.type === 'minusSign')?.value ?? '-',
      decimal: sample.find((part) => part.type === 'decimal')?.value ?? '.',
    };
    separators.set(locale, parts);
  }
  return parts;
}

function grouping(locale: string): Intl.NumberFormat {
  let format = groupings.get(locale);
  if (format === undefined) {
    // Grouped from five digits: a year (2026) or a short id keeps its digits
    // together, a count of 12,000 does not run its digits into one another.
    format = new Intl.NumberFormat(locale, { useGrouping: 'min2' });
    groupings.set(locale, format);
  }
  return format;
}

/**
 * A number exactly as JavaScript writes it, with the locale's separators:
 * `3.14159` stays `3.14159` (German `3,14159`), never rounded to the three
 * digits `Intl.NumberFormat` keeps by default; a number JavaScript writes
 * with an exponent (`1e+21`) and `NaN` stay as written.
 */
export function formatNumberExact(value: number, locale = 'en'): string {
  const text = String(value);
  if (!Number.isFinite(value) || /e/i.test(text)) return text;
  try {
    const negative = text.startsWith('-');
    const [whole = '0', fraction] = (negative ? text.slice(1) : text).split(
      '.',
    );
    const { minus, decimal } = numberParts(locale);
    return `${negative ? minus : ''}${grouping(locale).format(BigInt(whole))}${
      fraction === undefined ? '' : `${decimal}${fraction}`
    }`;
  } catch (error) {
    console.warn(`Couldn't write ${text} in "${locale}"`, error);
    return text;
  }
}

/** A recorded number's text in the reader's words, when it reads back as
 *  the same number; as recorded otherwise (a 64-bit id, `NaN`). */
function numberWords(text: string, locale: string): string {
  const number = Number(text);
  return text !== '' && Number.isFinite(number) && String(number) === text
    ? formatNumberExact(number, locale)
    : text;
}

function quote(t: TFunction, text: string): string {
  return t('summary.quote', { text });
}

/**
 * A recorded summary (`summaryOf`, written where the value was) in words:
 * "a list of 12 items", "an object with 3 fields", "“Fix login”", "a text
 * of 3,412 characters", "a hidden secret", "32 KB not kept".
 */
export function summaryWords(
  t: TFunction,
  summary: ValueSummary,
  options: SummarizeOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const locale = options.locale ?? 'en';
  switch (summary.kind) {
    case 'string': {
      const text = summary.text ?? '';
      const length = summary.length ?? text.length;
      return summary.cut === true || length > maxChars
        ? t('summary.longText', { count: length })
        : quote(t, text);
    }
    case 'number':
      return numberWords(summary.text ?? '', locale);
    case 'boolean':
      return summary.text === 'true' ? t('summary.true') : t('summary.false');
    case 'null':
      return t('summary.null');
    case 'undefined':
      return t('summary.missing');
    case 'array':
      return t('summary.list', { count: summary.length ?? 0 });
    case 'object':
      return t('summary.object', { count: summary.keys ?? 0 });
    case 'redacted':
      return t('summary.redacted');
    default:
      return t('summary.elided', {
        size: formatBytes(summary.bytes ?? 0, locale),
      });
  }
}

/**
 * A value in words, the way a sentence names it: a container by its size
 * ("a list of 12 items"), text quoted when it is short and by its length
 * when it is not, a number in the reader's separators.
 */
export function summarizeValue(
  t: TFunction,
  value: unknown,
  options: SummarizeOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  switch (kindOf(value)) {
    case 'string': {
      const text = String(value);
      return text.length > maxChars
        ? t('summary.longText', { count: text.length })
        : quote(t, text);
    }
    case 'array':
      return t('summary.list', {
        count: Array.isArray(value) ? value.length : 0,
      });
    case 'object':
      return t('summary.object', {
        count: isRecord(value) ? Object.keys(value).length : 0,
      });
    default:
      return formatValueInline(t, value, options);
  }
}

/**
 * A value inline, as a row or a change shows it: `250`, `“Fix login”`
 * (text cut to `maxChars` with "…"), `true`, `empty`, `missing`, and a
 * container by its size.
 */
export function formatValueInline(
  t: TFunction,
  value: unknown,
  options: SummarizeOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const locale = options.locale ?? 'en';
  switch (kindOf(value)) {
    case 'string': {
      const text = String(value);
      const head = cut(text, maxChars);
      return quote(t, head.length < text.length ? `${head}…` : head);
    }
    case 'number':
      return typeof value === 'bigint'
        ? value.toString()
        : formatNumberExact(Number(value), locale);
    case 'boolean':
      return value === true ? t('summary.true') : t('summary.false');
    case 'null':
      return t('summary.null');
    case 'undefined':
      return t('summary.missing');
    default:
      return summarizeValue(t, value, options);
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * A path the way an expression reads it: `issues[0].title`, with a key that
 * is not a plain name in brackets (`["first name"]`). The empty path is the
 * whole value, `''`.
 */
export function pathText(path: readonly (string | number)[]): string {
  let text = '';
  for (const segment of path) {
    if (typeof segment === 'number') text += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) {
      text += text === '' ? segment : `.${segment}`;
    } else text += `[${JSON.stringify(segment)}]`;
  }
  return text;
}
