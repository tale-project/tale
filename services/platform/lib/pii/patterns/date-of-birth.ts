/**
 * Date of birth — a numeric pass plus locale-composed textual passes.
 *
 * The numeric regex (`12.03.1980`, `1980-03-12`, …) is the pattern file's
 * data knob: every locale writes numeric dates the same way. Textual dates
 * are inherently locale-specific — each locale dataset's `dateOfBirth`
 * block contributes month names, abbreviations, context keywords and CJK
 * year/month/day markers, and this module composes:
 *
 *  - one Latin-style regex (covers Latin, Cyrillic, Greek, RTL, Indic —
 *    every script that writes dates as digit-and-word sequences) over the
 *    orderings `DAY (de|of) MONTH (de) YEAR` and `MONTH DAY, YEAR`, with
 *    optional context prefix and day ordinals (`28th`, `1er`, `28.`);
 *  - one CJK regex (`YYYY年MM月DD日` with optional context word before or
 *    after) from the union of the year/month/day markers.
 *
 * Locales without a `dateOfBirth` block contribute nothing.
 *
 * Every match passes a plausibility validator: the year must fall in
 * 1900..currentYear+1 (the +1 absorbs New-Year clock skew), the day/month
 * groups must be calendar-plausible — that is what keeps phone numbers and
 * card issue dates from reading as DOBs. Keywords are escaped and
 * longest-first ordered by the shared composer; all quantifiers are
 * bounded, and the composed regexes run under the engine's exec budget
 * like any other.
 */

import type { PiiPattern, PiiPatternRegex } from '../core/types';
import type { LocaleConfig } from '../schema';
import { composeKeywordAlternation } from './keywords';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

/** Scripts that use the ideographic year/month/day-marker date form. */
const CJK_SCRIPTS: ReadonlySet<string> = new Set([
  'jpan',
  'hans',
  'hant',
  'kore',
]);

const CURRENT_YEAR = new Date().getUTCFullYear();
const MIN_YEAR = 1900;
const MAX_YEAR = CURRENT_YEAR + 1;

// Both textual forms carry exactly one 4-digit group — the year — so the
// first 4-digit run in a match is always it.
const YEAR_EXTRACT_RE = /\d{4}/;
const NUMERIC_PARTS_RE = /(\d{1,4})[./\-–—](\d{1,2})[./\-–—](\d{1,4})/;
const LEADING_DAY_RE = /\d{1,2}/;

function yearLooksPlausible(matchedText: string): boolean {
  const m = matchedText.match(YEAR_EXTRACT_RE);
  if (!m) return false;
  const year = Number(m[0]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Numeric-date plausibility: plausible year, then plausible day/month.
 * A leading 4-digit group reads as YMD; otherwise DMY and MDY are both
 * accepted — without locale context the two cannot be told apart, so a
 * match passes when either interpretation forms a real date.
 */
function numericDateLooksPlausible(matchedText: string): boolean {
  if (!yearLooksPlausible(matchedText)) return false;

  const parts = matchedText.match(NUMERIC_PARTS_RE);
  if (!parts) return false;

  const g1 = Number(parts[1]);
  const g2 = Number(parts[2]);
  const g3 = Number(parts[3]);

  if (g1 >= 1000) {
    return g2 >= 1 && g2 <= 12 && g3 >= 1 && g3 <= 31;
  }
  const dmyOk = g2 >= 1 && g2 <= 12 && g1 >= 1 && g1 <= 31;
  const mdyOk = g1 >= 1 && g1 <= 12 && g2 >= 1 && g2 <= 31;
  return dmyOk || mdyOk;
}

/** Latin textual plausibility: plausible year plus a 1–31 leading day. */
function latinTextualLooksPlausible(matchedText: string): boolean {
  if (!yearLooksPlausible(matchedText)) return false;

  const dayMatch = matchedText.match(LEADING_DAY_RE);
  if (!dayMatch) return false;
  const day = Number(dayMatch[0]);
  return day >= 1 && day <= 31;
}

interface ComposedDob {
  latin: PiiPatternRegex | null;
  cjk: PiiPatternRegex | null;
}

// Content-digest cache over the DOB-relevant slice of each locale, sorted
// by code — injected locale data means codes alone do not identify the
// vocabulary.
const DOB_REGEX_CACHE = new Map<string, ComposedDob>();

function cacheKey(locales: ReadonlyArray<LocaleConfig>): string {
  return JSON.stringify(
    locales
      .map((l) => ({
        locale: l.locale,
        scripts: l.scripts,
        dob: l.dateOfBirth ?? null,
      }))
      .sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)),
  );
}

function partitionLocales(locales: ReadonlyArray<LocaleConfig>): {
  latinish: LocaleConfig[];
  cjk: LocaleConfig[];
} {
  const latinish: LocaleConfig[] = [];
  const cjk: LocaleConfig[] = [];
  for (const l of locales) {
    if (l.scripts.some((s) => CJK_SCRIPTS.has(s))) cjk.push(l);
    else latinish.push(l);
  }
  return { latinish, cjk };
}

function buildLatinTextualPattern(
  locales: ReadonlyArray<LocaleConfig>,
  name: string,
  replacement: string,
): PiiPatternRegex | null {
  const monthLists = locales.map((l) => [
    ...(l.dateOfBirth?.monthsLong ?? []),
    ...(l.dateOfBirth?.monthsShort ?? []),
  ]);
  const monthAlt = composeKeywordAlternation(monthLists);
  // An empty month union means no locale in the set carries textual DOB
  // vocabulary — contribute nothing rather than a never-matching regex.
  if (monthAlt === '(?!)') return null;

  const contextLists = locales.map((l) => l.dateOfBirth?.contextKeywords ?? []);
  const hasContext = contextLists.some((list) => list.length > 0);
  const contextAlt = hasContext
    ? composeKeywordAlternation(contextLists)
    : null;
  const contextPrefix =
    contextAlt && contextAlt !== '(?!)'
      ? `(?:(?:${contextAlt})[\\s:,.-]*)?`
      : '';

  // Day with an optional single ordinal token (`28th`, `1er`, `28.`) —
  // bounded so the group cannot backtrack.
  const dayWithOrdinal = '\\d{1,2}(?:\\.|er|ère|ere|st|nd|rd|th|e|º|ª|°)?';

  // Two ordering families: day-first (`28 de septiembre de 1998`,
  // `the 3rd of September 1998`, `12. März 1980`) and month-first
  // (`September 28, 1998`). The optional context prefix applies to both.
  const dmyDe = `(?:the\\s+)?${dayWithOrdinal}\\s+(?:(?:de|of)\\s+)?(?:${monthAlt})(?:\\s+de)?\\s+\\d{4}`;
  const mdy = `(?:${monthAlt})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`;
  const body = `(?:${dmyDe}|${mdy})`;

  // Unicode-letter lookarounds keep matches out of longer words
  // ("decemberish") — JS \b is ASCII-only.
  const source = `(?<![\\p{L}\\p{M}])${contextPrefix}${body}(?![\\p{L}\\p{M}])`;
  const regex = new RegExp(source, 'giu');

  return {
    name,
    regex,
    replacement,
    validate: latinTextualLooksPlausible,
  };
}

function buildCjkTextualPattern(
  locales: ReadonlyArray<LocaleConfig>,
  name: string,
  replacement: string,
): PiiPatternRegex | null {
  const yearMarkers = new Set<string>();
  const monthMarkers = new Set<string>();
  const dayMarkers = new Set<string>();
  for (const l of locales) {
    const dob = l.dateOfBirth;
    if (!dob) continue;
    if (dob.yearMarker) yearMarkers.add(dob.yearMarker);
    if (dob.monthMarker) monthMarkers.add(dob.monthMarker);
    if (dob.dayMarker) dayMarkers.add(dob.dayMarker);
  }
  if (
    yearMarkers.size === 0 ||
    monthMarkers.size === 0 ||
    dayMarkers.size === 0
  ) {
    return null;
  }

  // Single ideographs in practice, but routed through the shared composer
  // so the escaping contract stays uniform.
  const yearAlt = composeKeywordAlternation([[...yearMarkers]]);
  const monthAlt = composeKeywordAlternation([[...monthMarkers]]);
  const dayAlt = composeKeywordAlternation([[...dayMarkers]]);

  // Context words (`出生于`, `生まれ`, `생`) may precede or trail the date.
  const contextLists = locales.map((l) => l.dateOfBirth?.contextKeywords ?? []);
  const contextAlt = composeKeywordAlternation(contextLists);
  const ctx = contextAlt === '(?!)' ? null : contextAlt;

  const core = `\\d{4}(?:${yearAlt})\\d{1,2}(?:${monthAlt})\\d{1,2}(?:${dayAlt})`;
  const source = ctx ? `(?:(?:${ctx})\\s*)?${core}(?:\\s*(?:${ctx}))?` : core;
  const regex = new RegExp(source, 'gu');

  return {
    name,
    regex,
    replacement,
    validate: yearLooksPlausible,
  };
}

function composeFromLocales(
  locales: ReadonlyArray<LocaleConfig>,
  name: string,
  replacement: string,
): ComposedDob {
  const key = cacheKey(locales);
  const cached = DOB_REGEX_CACHE.get(key);
  if (cached) return cached;

  const { latinish, cjk } = partitionLocales(locales);
  const composed: ComposedDob = {
    latin:
      latinish.length > 0
        ? buildLatinTextualPattern(latinish, name, replacement)
        : null,
    cjk: cjk.length > 0 ? buildCjkTextualPattern(cjk, name, replacement) : null,
  };
  DOB_REGEX_CACHE.set(key, composed);
  return composed;
}

export const buildDateOfBirthPattern: NativePatternBuilder = (file) => {
  const numericRegex = compileRegexKnob(file);
  const numericPattern: PiiPatternRegex | null = numericRegex
    ? {
        name: file.name,
        regex: numericRegex,
        replacement: file.replacement,
        validate: numericDateLooksPlausible,
      }
    : null;

  return (locales) => {
    const out: PiiPattern[] = [];
    if (numericPattern) out.push(numericPattern);
    const composed = composeFromLocales(locales, file.name, file.replacement);
    if (composed.latin) out.push(composed.latin);
    if (composed.cjk) out.push(composed.cjk);
    return out;
  };
};
