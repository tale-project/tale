/**
 * Card-verification-code (CVC / CVV / CV2) detection — context-anchored.
 *
 * Detection strategy
 *   - Bare 3-4 digit numbers are intentionally NOT detected (they would
 *     false-positive on ages, room numbers, error codes, prices). This
 *     pattern only catches the labeled form: `CVC: 123`, `cvv = 1234`,
 *     `cryptogramme visuel 999`, etc.
 *
 * Locale composition
 *   - The keyword set is the union of `cvcContextKeywords` across every
 *     enabled locale, regex-escaped and longest-first ordered. Adding a
 *     locale = adding its CVC keywords to its JSON; no code change.
 *
 * Filler between keyword and value
 *   - The regex accepts an optional 1-4 character word between the
 *     keyword and the number (`CVC is 123`, `CVV est 123`, `CVV ist 123`).
 *     The connector word is intentionally NOT in a locale list — it would
 *     be one entry per locale for a tiny benefit, and a length-bounded
 *     wildcard is the same false-positive surface (a 1-4 char word that
 *     ALSO has a CVC keyword left of it and a 3-4 digit number right of
 *     it is by overwhelming odds an actual filler).
 *
 * Accepted false negatives
 *   - Anonymous "the security code is 123" without an explicit keyword
 *     from any enabled locale. This mirrors the design choice of
 *     Microsoft Presidio, AWS Comprehend, and Cloudflare WAF.
 */

import type { PiiPattern, PiiPatternFactory } from '../core/types';
import { composeKeywordAlternation } from '../locales';
import type { LocaleConfig } from '../locales/types';

// Compiled-regex cache, keyed by sorted locale codes — same locale set →
// same regex object. Avoids reparsing on every `createScrubber` call.
const CVC_REGEX_CACHE = new Map<string, RegExp>();

function composeCvcRegex(locales: ReadonlyArray<LocaleConfig>): RegExp {
  const cacheKey = locales
    .map((l) => l.locale)
    .slice()
    .sort()
    .join(',');
  const cached = CVC_REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const keywords = composeKeywordAlternation(
    locales.map((l) => l.cvcContextKeywords),
  );
  // `(?:\s+\S{1,4}(?=\s))?` is the locale-agnostic filler — any short
  // adjacency word (`is` / `est` / `ist` / `の` / `на`) between the keyword
  // and the number. Bounded length keeps false-positive surface tiny.
  // `(?![\p{L}\p{M}])` is the Unicode-aware right boundary after the
  // keyword so `CVCs` doesn't trigger on `CVC`.
  const regex = new RegExp(
    `(?<![\\p{L}\\p{M}])(?:${keywords})(?![\\p{L}\\p{M}])(?:\\s+\\S{1,4}(?=\\s))?\\s*[:=]?\\s*\\d{3,4}\\b`,
    'giu',
  );
  CVC_REGEX_CACHE.set(cacheKey, regex);
  return regex;
}

export const cvcFactory: PiiPatternFactory = (locales) => {
  const pattern: PiiPattern = {
    name: 'cvc',
    regex: composeCvcRegex(locales),
    replacement: '[CVC]',
  };
  return [pattern];
};
