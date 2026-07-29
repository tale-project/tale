/**
 * Card-verification code — context-anchored only. Bare 3–4 digit numbers
 * are deliberately not detected (ages, room numbers, error codes, prices);
 * this pattern fires on the labeled form: `CVC: 123`, `cvv = 1234`,
 * `Kartenprüfnummer 999`.
 *
 * The keyword set is the union of `cvcContextKeywords` across the enabled
 * locales — adding a locale's vocabulary is a dataset edit, never a code
 * change. The regex accepts one short (1–4 char) filler word between the
 * keyword and the digits (`CVC is 123`, `CVV est 123`): a bounded wildcard
 * has the same false-positive surface as listing every language's copula
 * and costs nothing to maintain. Unmatched "the security code is 123"
 * without a keyword is an accepted false negative — the same call
 * mainstream DLP engines make.
 *
 * Composed regexes are cached by a content digest of the participating
 * keyword lists (not just locale codes): locale data is injected, so two
 * registries may carry different vocabularies for the same code.
 */

import type { PiiPattern } from '../core/types';
import type { LocaleConfig } from '../schema';
import { composeKeywordAlternation } from './keywords';
import type { NativePatternBuilder } from './native';

const CVC_REGEX_CACHE = new Map<string, RegExp>();

function composeCvcRegex(locales: ReadonlyArray<LocaleConfig>): RegExp {
  const cacheKey = JSON.stringify(
    locales
      .map((l) => ({ locale: l.locale, keywords: l.cvcContextKeywords }))
      .sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)),
  );
  const cached = CVC_REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const keywords = composeKeywordAlternation(
    locales.map((l) => l.cvcContextKeywords),
  );
  // `(?<![\p{L}\p{M}])` / `(?![\p{L}\p{M}])` are Unicode-aware word
  // boundaries around the keyword (JS `\b` is ASCII-only even under /u,
  // and must not fire inside `CVCs`). `(?:\s+\S{1,4}(?=\s))?` is the
  // bounded locale-agnostic filler described above.
  const regex = new RegExp(
    `(?<![\\p{L}\\p{M}])(?:${keywords})(?![\\p{L}\\p{M}])(?:\\s+\\S{1,4}(?=\\s))?\\s*[:=]?\\s*\\d{3,4}\\b`,
    'giu',
  );
  CVC_REGEX_CACHE.set(cacheKey, regex);
  return regex;
}

export const buildCvcPattern: NativePatternBuilder = (file) => (locales) => {
  const pattern: PiiPattern = {
    name: file.name,
    regex: composeCvcRegex(locales),
    replacement: file.replacement,
  };
  return [pattern];
};
