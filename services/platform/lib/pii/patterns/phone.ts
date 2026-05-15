/**
 * Phone-number detection — hybrid: libphonenumber-js + context-anchored regex.
 *
 * Why hybrid
 *   - `libphonenumber-js` is the canonical international phone parser: it
 *     handles country dial codes, formatting variants, and validation.
 *     Its matcher only fires on internationally-formatted numbers
 *     (`+CC ...`) without a `defaultCountry`, so it misses the common
 *     local form `Tel: 030 12345678`.
 *   - The context-anchored regex catches the local form: any digit run
 *     adjacent to a phone keyword from any enabled locale.
 *
 * Locale composition
 *   - The keyword regex is built from the union of every enabled locale's
 *     `phoneContextKeywords`. Longest-first ordering so JavaScript's
 *     leftmost-first alternation favors `téléphone` over `tél`. Keywords
 *     are regex-escaped at composition.
 *
 * Performance defenses
 *   - libphonenumber's PhoneNumberMatcher re-validates every digit cluster;
 *     phone-saturated inputs can spike to ~180 ms p99. We cap input length
 *     (32 KB) and cluster count (200) before invoking libphone; a 40 ms
 *     wall-clock budget terminates the loop early. In those fail-open
 *     cases, the context regex (sub-millisecond) is still the fallback.
 *
 * `00`-prefix handling
 *   - libphone recognizes only `+` international prefix. Business-card-style
 *     `0049 30 ...` is converted to `+49 30 ...` via `buildPhonePosMap`,
 *     which also produces a position map so libphone's offsets translate
 *     back to original text. Conversion is conservative — only triggers at
 *     start-of-string or after a non-digit, never inside a number body.
 */

import { findPhoneNumbersInText } from 'libphonenumber-js/min';

import type {
  PiiMatchSpan,
  PiiPattern,
  PiiPatternFactory,
} from '../core/types';
import { composeKeywordAlternation } from '../locales';
import type { LocaleConfig } from '../locales/types';

// libphone performance bounds.
const PHONE_LIBPHONE_MAX_LEN = 32_000;
const PHONE_LIBPHONE_MAX_CLUSTERS = 200;
const PHONE_LIBPHONE_BUDGET_MS = 40;
const PHONE_CLUSTER_RE = /[\d][\d\s\-().]{8,}/g;
const PHONE_DIGIT_RE = /\d/g;

function countMatches(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s) !== null) {
    n++;
    if (re.lastIndex === 0) break;
  }
  return n;
}

/**
 * Convert leading `00` international-prefix groups to `+` so
 * libphonenumber-js (which only recognizes the `+` form) catches the
 * `0049 30 ...` business-card form. Returns the converted string plus a
 * position map.
 *
 * Replacement triggers only when the `00` sits at start-of-string OR after
 * a non-digit, non-`+` char — that prevents rewriting inside `1-200-...`
 * style numbers where `00` appears mid-body.
 */
function buildPhonePosMap(orig: string): {
  converted: string;
  mapToOrig: (pos: number) => number;
} {
  if (orig.indexOf('00') === -1) {
    return { converted: orig, mapToOrig: (p: number) => p };
  }
  let converted = '';
  const map: number[] = [];
  let i = 0;
  while (i < orig.length) {
    const prevIsDigitOrPlus = i > 0 && /[\d+]/.test(orig[i - 1] ?? '');
    if (
      !prevIsDigitOrPlus &&
      orig[i] === '0' &&
      orig[i + 1] === '0' &&
      /\d/.test(orig[i + 2] ?? '')
    ) {
      map.push(i);
      converted += '+';
      i += 2;
    } else {
      map.push(i);
      converted += orig[i];
      i += 1;
    }
  }
  map.push(orig.length);
  return {
    converted,
    mapToOrig: (pos: number) => {
      // `pos === map.length` is also out of range — the map has indices
      // `[0, map.length - 1]`, so the `>` comparison was off by one
      // and silently skipped warning on the boundary case. The actual
      // return below is still safe via `Math.min(pos, map.length - 1)`.
      if (pos < 0 || pos >= map.length) {
        console.debug(
          `[pii] phone pos-map offset out of range pos=${pos} mapLen=${map.length}`,
        );
      }
      return map[Math.min(pos, map.length - 1)] ?? orig.length;
    },
  };
}

/**
 * Compose the context-anchor keyword regex from the union of phone
 * keywords across `locales`.
 *
 * Returns a regex that captures the keyword + separator chars + a digit
 * group (the group is what gets masked; the keyword stays). Unicode-aware
 * boundary lookarounds so NFD-decomposed `é` doesn't slip past.
 *
 * Cached by a JSON-stringified `{locale, keywords}` digest sorted by
 * locale code so the cache stays correct when an embedder overrides
 * `phoneContextKeywords` for the same locale code via `PatternRegistry`.
 */
const PHONE_REGEX_CACHE = new Map<string, RegExp>();

function composePhoneContextRegex(
  locales: ReadonlyArray<LocaleConfig>,
): RegExp {
  const cacheKey = JSON.stringify(
    locales
      .map((l) => ({
        locale: l.locale,
        keywords: l.phoneContextKeywords.slice(),
      }))
      .sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)),
  );
  const cached = PHONE_REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const keywordAlternation = composeKeywordAlternation(
    locales.map((l) => l.phoneContextKeywords),
  );
  const regex = new RegExp(
    `(?<![\\p{L}\\p{M}])(?:${keywordAlternation})(?![\\p{L}\\p{M}])[\\s:.\\-/]*(\\+?[\\d(][\\d\\s\\-()./]{6,24})`,
    'giu',
  );
  PHONE_REGEX_CACHE.set(cacheKey, regex);
  return regex;
}

export const phoneFactory: PiiPatternFactory = (locales) => {
  const contextRegex = composePhoneContextRegex(locales);

  const detect = (text: string): PiiMatchSpan[] => {
    const out: PiiMatchSpan[] = [];

    // libphone path — gated on input size and cluster count.
    const tooLarge = text.length > PHONE_LIBPHONE_MAX_LEN;
    const clusterCount = countMatches(PHONE_CLUSTER_RE, text);
    const tooMany = clusterCount > PHONE_LIBPHONE_MAX_CLUSTERS;

    if (!tooLarge && !tooMany) {
      const { converted, mapToOrig } = buildPhonePosMap(text);
      const start = Date.now();
      try {
        for (const n of findPhoneNumbersInText(converted)) {
          const origStart = mapToOrig(n.startsAt);
          const origEnd = mapToOrig(n.endsAt);
          out.push({
            start: origStart,
            end: origEnd,
            matchedText: text.slice(origStart, origEnd),
          });
          if (Date.now() - start > PHONE_LIBPHONE_BUDGET_MS) {
            console.debug(
              '[pii] libphonenumber-js exceeded budget, partial result',
            );
            break;
          }
        }
      } catch (err) {
        console.debug(
          `[pii] libphonenumber-js threw: ${err instanceof Error ? err.name : 'unknown'}`,
        );
      }
    }

    // Context-anchored local-number path.
    contextRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = contextRegex.exec(text)) !== null) {
      const numberStr = m[1];
      if (!numberStr) continue;
      // Trim trailing whitespace, punctuation (`.,;:`), and decorative
      // dashes (`–`, `—`) inside the captured group so the masker doesn't
      // swallow inter-word spacing or sentence-ending punctuation. Do NOT
      // trim `)` — phones like `(030) 12345` legitimately end in `)`.
      const trimmed = numberStr.replace(/[\s.,;:\u2013\u2014]+$/, '');
      if (trimmed.length === 0) continue;
      const numberStart = m.index + m[0].lastIndexOf(numberStr);
      const digits = countMatches(PHONE_DIGIT_RE, trimmed);
      if (digits >= 7) {
        out.push({
          start: numberStart,
          end: numberStart + trimmed.length,
          matchedText: trimmed,
        });
      }
    }

    return out;
  };

  const pattern: PiiPattern = {
    name: 'phone',
    detect,
    replacement: '[PHONE]',
  };
  return [pattern];
};
