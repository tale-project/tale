/**
 * Phone numbers — hybrid detection.
 *
 * Two passes, because neither alone covers real input:
 *  - `libphonenumber-js` finds internationally formatted numbers
 *    (`+CC …`) with real validation, but without a default country it
 *    misses the everyday local form `Tel: 030 12345678`.
 *  - A context-anchored regex composed from the union of every enabled
 *    locale's `phoneContextKeywords` catches exactly that local form: a
 *    digit run adjacent to a phone keyword.
 *
 * Performance bounds: libphonenumber re-validates every digit cluster and
 * spikes on phone-saturated payloads, so its pass is gated on input length
 * (32 KB) and cluster count (200) and cut off by a 40 ms wall-clock budget
 * — fail-open, with the sub-millisecond context regex as the remaining
 * net. Business-card `00`-prefixed international numbers (`0049 30 …`) are
 * converted to `+` form for the scan through a position map that
 * translates libphonenumber's offsets back to the original text; the
 * conversion only fires at a string start or after a non-digit, never
 * inside a number body.
 */

import { findPhoneNumbersInText } from 'libphonenumber-js/min';

import type { PiiMatchSpan, PiiPattern } from '../core/types';
import type { LocaleConfig } from '../schema';
import { composeKeywordAlternation } from './keywords';
import type { NativePatternBuilder } from './native';

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
 * Convert leading `00` international prefixes to `+` and return the
 * converted text plus an offset map back into the original.
 */
function buildPhonePosMap(orig: string): {
  converted: string;
  mapToOrig: (pos: number) => number;
} {
  if (!orig.includes('00')) {
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
      if (pos < 0 || pos >= map.length) {
        console.debug(
          `[pii] phone pos-map offset out of range pos=${pos} mapLen=${map.length}`,
        );
      }
      return map[Math.min(pos, map.length - 1)] ?? orig.length;
    },
  };
}

// Content-digest cache: the keyword sets come from injected locale data,
// so the key includes the actual keywords, not just locale codes.
const PHONE_REGEX_CACHE = new Map<string, RegExp>();

function composePhoneContextRegex(
  locales: ReadonlyArray<LocaleConfig>,
): RegExp {
  const cacheKey = JSON.stringify(
    locales
      .map((l) => ({ locale: l.locale, keywords: l.phoneContextKeywords }))
      .sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)),
  );
  const cached = PHONE_REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const keywordAlternation = composeKeywordAlternation(
    locales.map((l) => l.phoneContextKeywords),
  );
  // Unicode-aware boundaries around the keyword; the captured group is the
  // digit run that gets masked (the keyword itself stays).
  const regex = new RegExp(
    `(?<![\\p{L}\\p{M}])(?:${keywordAlternation})(?![\\p{L}\\p{M}])[\\s:.\\-/]*(\\+?[\\d(][\\d\\s\\-()./]{6,24})`,
    'giu',
  );
  PHONE_REGEX_CACHE.set(cacheKey, regex);
  return regex;
}

export const buildPhonePattern: NativePatternBuilder = (file) => (locales) => {
  const contextRegex = composePhoneContextRegex(locales);

  const detect = (text: string): PiiMatchSpan[] => {
    const out: PiiMatchSpan[] = [];

    // libphonenumber pass, gated on size and cluster count.
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

    // Context-anchored local-number pass.
    contextRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = contextRegex.exec(text)) !== null) {
      const numberStr = m[1];
      if (!numberStr) continue;
      // Trim trailing whitespace, sentence punctuation, and decorative
      // dashes from the captured group so the masker never swallows
      // inter-word spacing. `)` stays — `(030) 12345` ends legitimately
      // with one.
      const trimmed = numberStr.replace(/[\s.,;:–—]+$/, '');
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
    name: file.name,
    detect,
    replacement: file.replacement,
  };
  return [pattern];
};
