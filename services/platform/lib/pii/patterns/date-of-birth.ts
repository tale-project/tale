/**
 * Date-of-birth detection — numeric + textual, locale-aware.
 *
 * Why two passes
 *   - The numeric regex (`12.03.1980`, `1980-03-12`, …) is script- and
 *     locale-independent: every locale writes ISO-style or
 *     dotted/slashed/dashed numeric dates the same way. We keep it
 *     unchanged so existing fixtures and the locale-blind call path
 *     (`createScrubber()` without an explicit locale set) behave
 *     identically to Wave 2.
 *   - Textual DOBs (`born on March 28, 1998`, `geboren am 12. März 1980`,
 *     `1998年9月28日生`, …) are inherently locale-specific. Each locale's
 *     `dateOfBirth: DateOfBirthConfig` JSON entry contributes month names,
 *     short forms, context keywords, and CJK year/month/day markers; the
 *     factory composes one textual regex per script family from the union
 *     across the enabled locale set. Locales without a `dateOfBirth`
 *     block contribute nothing — adding textual coverage for a new locale
 *     is a JSON edit.
 *
 * Composition strategy
 *   - Latin / Cyrillic / RTL family: one alternation covering
 *       (a) `DAY MONTH YEAR`        — `28 September 1998`, `1er janvier 1980`
 *       (b) `MONTH DAY, YEAR`       — `September 28, 1998`, `January 1 1990`
 *       (c) `DAY de MONTH de YEAR`  — `28 de septiembre de 1998`
 *     Optional preceding context keyword (`born on`, `geboren am`, …). The
 *     `\d{1,2}` may carry a locale ordinal suffix (`st nd rd th`, `er ère`).
 *   - CJK family (jpan / hans / hant / kore): `YYYY<year>MM<month>DD<day>`
 *     using the union of `yearMarker`/`monthMarker`/`dayMarker` characters
 *     across enabled CJK locales. Optional CJK context keyword prefix
 *     (`出生于`, `生まれ`, `생` etc. — declared via `contextKeywords`).
 *
 * Plausibility filter
 *   - Year must fall in 1900 .. currentYear + 1. The `validate` callback
 *     extracts the 4-digit year from the match and rejects implausible
 *     ones; this prevents a 10-digit phone number, a credit-card year-of-
 *     issue, or any random 4-digit run from being read as a DOB.
 *   - currentYear is captured at module load. The +1 slack covers locales
 *     where the calendar year ticks over before the system clock used in
 *     a test or fixture, and avoids a 1-second flaky window on New Year's
 *     Eve.
 *
 * ReDoS defenses
 *   - Every keyword goes through `escapeRegExp` (via
 *     `composeKeywordAlternation`) before being concatenated — keyword
 *     JSON files contain literals, not regex.
 *   - The alternation orders longest-first (also handled by
 *     `composeKeywordAlternation`) so JavaScript leftmost-first match
 *     selection favors the more specific keyword.
 *   - No nested unbounded quantifiers. Day is `\d{1,2}`, year is `\d{4}`,
 *     and the optional ordinal/`de`/`,` glue is bounded.
 *   - The numeric pattern is still gated by `execWithBudget` as before;
 *     the textual patterns inherit the same gate via the engine's
 *     standard regex path.
 *
 * Caching
 *   - Composed regex per `{locale, dateOfBirth}` digest, identical to the
 *     phone composer. Embedders that override locale data via
 *     `PatternRegistry` produce a fresh digest and get a fresh regex —
 *     the cache cannot leak stale state.
 */

import type {
  PiiPattern,
  PiiPatternFactory,
  PiiPatternRegex,
} from '../core/types';
import { composeKeywordAlternation } from '../locales';
import type { LocaleConfig } from '../locales/types';

// Scripts that use the CJK ideographic year/month/day-marker form.
const CJK_SCRIPTS: ReadonlySet<string> = new Set([
  'jpan',
  'hans',
  'hant',
  'kore',
]);

// Year-plausibility bounds. Captured at module load to avoid recomputing
// per match; the +1 slack on the upper bound is intentional (see header).
const CURRENT_YEAR = new Date().getUTCFullYear();
const MIN_YEAR = 1900;
const MAX_YEAR = CURRENT_YEAR + 1;

// Extracts the first 4-digit run from a candidate DOB string. The textual
// patterns put the year either trailing (Latin) or leading (CJK); in
// both cases there is exactly one `\d{4}` group in the match, so the
// first run is the year.
const YEAR_EXTRACT_RE = /\d{4}/;

// Extracts up to three numeric groups from a numeric date string. Handles
// separators `.` `/` `-` `–` `—` between groups. Pre-compiled at module
// level to avoid per-match recompilation.
const NUMERIC_PARTS_RE = /(\d{1,4})[./\-–—](\d{1,2})[./\-–—](\d{1,4})/;

// Extracts the leading day number from a Latin textual match like
// "28 September 1998" or "1er janvier 1980".
const LEADING_DAY_RE = /\d{1,2}/;

function yearLooksPlausible(matchedText: string): boolean {
  const m = matchedText.match(YEAR_EXTRACT_RE);
  if (!m) return false;
  const year = Number(m[0]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Validates a numeric date match by checking:
 *   1. Year plausibility (1900..currentYear+1)
 *   2. Day/month plausibility (month 1-12, day 1-31)
 *
 * Supports both DMY/MDY (`dd.mm.yyyy`) and YMD (`yyyy-mm-dd`) orderings.
 * When the first group is 4 digits it is treated as YMD; otherwise we
 * treat it as DMY/MDY and check that at least one of (g1=day,g2=month)
 * or (g1=month,g2=day) is valid — we cannot distinguish DD/MM from
 * MM/DD without locale context, so we accept if either interpretation
 * produces a plausible date.
 */
function numericDateLooksPlausible(matchedText: string): boolean {
  if (!yearLooksPlausible(matchedText)) return false;

  const parts = matchedText.match(NUMERIC_PARTS_RE);
  if (!parts) return false;

  const g1 = Number(parts[1]);
  const g2 = Number(parts[2]);
  const g3 = Number(parts[3]);

  if (g1 >= 1000) {
    // YMD: g1=year, g2=month, g3=day
    return g2 >= 1 && g2 <= 12 && g3 >= 1 && g3 <= 31;
  }
  // DMY or MDY — accept if either interpretation is plausible.
  const dmyOk = g2 >= 1 && g2 <= 12 && g1 >= 1 && g1 <= 31;
  const mdyOk = g1 >= 1 && g1 <= 12 && g2 >= 1 && g2 <= 31;
  return dmyOk || mdyOk;
}

/**
 * Validates a Latin textual date match. Checks year plausibility and
 * that the day component (the leading digit run) is 1-31.
 */
function latinTextualLooksPlausible(matchedText: string): boolean {
  if (!yearLooksPlausible(matchedText)) return false;

  const dayMatch = matchedText.match(LEADING_DAY_RE);
  if (!dayMatch) return false;
  const day = Number(dayMatch[0]);
  return day >= 1 && day <= 31;
}

/**
 * Pre-existing numeric pattern. Kept verbatim — it is the proven path
 * for ISO and dotted/slashed/dashed numeric dates and there is no
 * locale-specific behaviour to layer on.
 */
const NUMERIC_PATTERN: PiiPatternRegex = {
  name: 'dateOfBirth',
  regex:
    /(?<!\w)(?:\d{1,2}[./—–-]\d{1,2}[./—–-]\d{2,4}|\d{4}[./—–-]\d{1,2}[./—–-]\d{1,2})(?=[T\s,;.)\]]|$|[^\w])/g,
  replacement: '[DATE_OF_BIRTH]',
  validate: numericDateLooksPlausible,
};

// -----------------------------------------------------------------------------
// Composition cache
// -----------------------------------------------------------------------------

interface ComposedDob {
  latin: PiiPatternRegex | null;
  cjk: PiiPatternRegex | null;
}

const DOB_REGEX_CACHE = new Map<string, ComposedDob>();

function cacheKey(locales: ReadonlyArray<LocaleConfig>): string {
  // Only the DOB-relevant slice of each locale participates in the digest.
  // Sorting by locale code keeps the key stable regardless of caller
  // ordering. JSON-stringification mirrors the cache-key approach used in
  // phone.ts so embedders that override one locale's DOB block via
  // `PatternRegistry` automatically invalidate the cache for any set
  // containing that locale.
  return JSON.stringify(
    locales
      .map((l) => ({
        locale: l.locale,
        scripts: l.scripts.slice(),
        dob: l.dateOfBirth ?? null,
      }))
      .sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)),
  );
}

/**
 * Partition locales into Latin-script-style (everything that uses
 * space-separated month names) versus CJK-script-style (ideographic
 * year/month/day markers). A locale is CJK if any of its declared scripts
 * is in `CJK_SCRIPTS`. Latin-style covers Latin, Cyrillic, Greek, Arabic,
 * Hebrew, Devanagari, etc. — every script where dates are written as
 * sequences of digits and words.
 */
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
): PiiPatternRegex | null {
  // Union month names + abbreviations across every Latin-style locale.
  // Locales without a `dateOfBirth` block contribute nothing — the
  // composer treats `undefined` arrays as empty.
  const monthLists = locales.map((l) => [
    ...(l.dateOfBirth?.monthsLong ?? []),
    ...(l.dateOfBirth?.monthsShort ?? []),
  ]);
  const monthAlt = composeKeywordAlternation(monthLists);
  // `composeKeywordAlternation` returns `(?!)` for an empty union — that
  // regex never matches, so a `dateOfBirth`-free locale selection
  // contributes no textual pattern at all.
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

  // Day-with-optional-ordinal: covers EN `28th`, FR `1er` / `1ère`,
  // DE `28.`, and bare `28`. Bounded to a single trailing token so the
  // group cannot backtrack.
  const dayWithOrdinal = '\\d{1,2}(?:\\.|er|ère|ere|st|nd|rd|th|e|º|ª|°)?';

  // Four orderings, in priority of specificity:
  //   1. `(the )?DAY (de|of )?MONTH( de)? YEAR` — ES/PT use `de`, EN uses `of`.
  //   2. `MONTH DAY,? YEAR`                     — EN MDY.
  //   3. `DAY MONTH YEAR`                        — DE/FR/IT/NL/RU/AR/HE/RU…
  // Optional context prefix applies to all.
  // `(?:the\\s+)?` allows English "the 3rd of September" without false
  // positives — "the" only appears after context keywords or at a non-letter
  // boundary, and the day ordinal + month name combo is specific enough.
  const dmyDe = `(?:the\\s+)?${dayWithOrdinal}\\s+(?:(?:de|of)\\s+)?(?:${monthAlt})(?:\\s+de)?\\s+\\d{4}`;
  const mdy = `(?:${monthAlt})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`;
  const body = `(?:${dmyDe}|${mdy})`;

  // Non-letter lookbehind/ahead prevents matches inside longer words
  // ("decemberish" should not slip through). Unicode property classes
  // catch combining marks for normalized accents.
  const source = `(?<![\\p{L}\\p{M}])${contextPrefix}${body}(?![\\p{L}\\p{M}])`;
  const regex = new RegExp(source, 'giu');

  return {
    name: 'dateOfBirth',
    regex,
    replacement: '[DATE_OF_BIRTH]',
    validate: latinTextualLooksPlausible,
  };
}

function buildCjkTextualPattern(
  locales: ReadonlyArray<LocaleConfig>,
): PiiPatternRegex | null {
  // CJK form is `YYYY<year>MM<month>DD<day>` — we need the union of
  // year/month/day markers across every CJK locale in the selection.
  // Locales that supply only a subset still contribute via the union.
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

  // `composeKeywordAlternation` handles escaping + longest-first for the
  // marker sets too — these are single ideographic characters in
  // practice but routing through the same helper keeps the escaping
  // contract uniform.
  const yearAlt = composeKeywordAlternation([[...yearMarkers]]);
  const monthAlt = composeKeywordAlternation([[...monthMarkers]]);
  const dayAlt = composeKeywordAlternation([[...dayMarkers]]);

  // CJK context keywords (`生まれ`, `出生于`, `생`, …). Optional and
  // may appear either before the date (`出生于1998年9月28日`) or
  // immediately after (`1998年9月28日生`). We allow both via two
  // bracketed alternates around the YMD core.
  const contextLists = locales.map((l) => l.dateOfBirth?.contextKeywords ?? []);
  const contextAlt = composeKeywordAlternation(contextLists);
  const ctx = contextAlt === '(?!)' ? null : contextAlt;

  const core = `\\d{4}(?:${yearAlt})\\d{1,2}(?:${monthAlt})\\d{1,2}(?:${dayAlt})`;
  const source = ctx ? `(?:(?:${ctx})\\s*)?${core}(?:\\s*(?:${ctx}))?` : core;
  const regex = new RegExp(source, 'gu');

  return {
    name: 'dateOfBirth',
    regex,
    replacement: '[DATE_OF_BIRTH]',
    validate: yearLooksPlausible,
  };
}

function composeFromLocales(locales: ReadonlyArray<LocaleConfig>): ComposedDob {
  const key = cacheKey(locales);
  const cached = DOB_REGEX_CACHE.get(key);
  if (cached) return cached;

  const { latinish, cjk } = partitionLocales(locales);
  const composed: ComposedDob = {
    latin: latinish.length > 0 ? buildLatinTextualPattern(latinish) : null,
    cjk: cjk.length > 0 ? buildCjkTextualPattern(cjk) : null,
  };
  DOB_REGEX_CACHE.set(key, composed);
  return composed;
}

export const dateOfBirthFactory: PiiPatternFactory = (locales) => {
  const out: PiiPattern[] = [NUMERIC_PATTERN];
  const composed = composeFromLocales(locales);
  if (composed.latin) out.push(composed.latin);
  if (composed.cjk) out.push(composed.cjk);
  return out;
};
