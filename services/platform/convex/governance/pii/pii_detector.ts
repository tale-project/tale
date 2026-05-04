import { execWithBudget } from '../regex_safety';
import type { PiiMatchSpan, PiiPattern } from './pii_patterns';

export interface PiiMatch {
  patternName: string;
  start: number;
  end: number;
  matchedText: string;
  replacement: string;
}

/**
 * Resolves a single pattern's matches against the input text. Three pattern
 * shapes are supported:
 *
 *  - `detect` (function-form): library scanners like libphonenumber-js. Skips
 *    `execWithBudget` because the library has its own performance contract.
 *  - `regex` + `validate`: classical regex finds candidates; validate() acts
 *    as a post-filter (IBAN mod-97, credit-card Luhn). validate() is wrapped
 *    in try/catch so a thrown error from the validator never propagates the
 *    matched text into the log line — only the pattern name and `err.name`
 *    are logged (GDPR: matched text may be PII).
 *  - `regex` only: legacy path, unchanged.
 *
 * If a pattern has neither `regex` nor `detect` we log and skip — preventing
 * the prior NPE on `pattern.regex.source` after the field was made optional.
 */
function resolveMatches(text: string, pattern: PiiPattern): PiiMatchSpan[] {
  if (pattern.detect) {
    try {
      return pattern.detect(text);
    } catch (err) {
      console.debug(
        `[pii_detector] detect() threw for pattern ${pattern.name}: ${
          err instanceof Error ? err.name : 'unknown'
        }`,
      );
      return [];
    }
  }
  if (!pattern.regex) {
    console.debug(
      `[pii_detector] pattern ${pattern.name} has neither regex nor detect; skipping`,
    );
    return [];
  }
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
  const out: PiiMatchSpan[] = [];
  for (const m of execWithBudget(regex, text)) {
    if (pattern.validate) {
      let ok = false;
      try {
        ok = pattern.validate(m.matchedText);
      } catch (err) {
        console.debug(
          `[pii_detector] validate() threw for pattern ${pattern.name}: ${
            err instanceof Error ? err.name : 'unknown'
          }`,
        );
        continue;
      }
      if (!ok) continue;
    }
    out.push({
      start: m.index,
      end: m.index + m.length,
      matchedText: m.matchedText,
    });
  }
  return out;
}

/**
 * Merge overlapping matches into a non-overlapping set.
 *
 * Without this, e.g. `phone` matching a 14-char prefix of a 19-char
 * `creditCard` match leaves both in the list; the masker (which splices using
 * original indices into a mutating string) sees the second range's `match.end`
 * pointing past where the string has shifted, and adjacent text — sometimes
 * the next replacement token entirely — gets eaten. (Regression #1618.)
 *
 * Policy: longest match wins; on equal length, earlier insertion (i.e. earlier
 * pattern in `BUILT_IN_PII_PATTERNS`) wins, courtesy of stable sort.
 *
 * Exported because the v2 detector composes regex- and function-based matches
 * and benefits from a single canonical dedup. (R2-? — pii_detector_dedup_test.)
 */
export function dedupOverlaps(matches: PiiMatch[]): PiiMatch[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const kept: PiiMatch[] = [];
  for (const m of sorted) {
    const last = kept[kept.length - 1];
    if (!last || m.start >= last.end) {
      kept.push(m);
    } else if (m.end - m.start > last.end - last.start) {
      kept[kept.length - 1] = m;
    }
  }
  return kept;
}

export function detectPii(text: string, patterns: PiiPattern[]): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const pattern of patterns) {
    for (const span of resolveMatches(text, pattern)) {
      matches.push({
        patternName: pattern.name,
        start: span.start,
        end: span.end,
        matchedText: span.matchedText,
        replacement: pattern.replacement,
      });
    }
  }
  return dedupOverlaps(matches);
}
