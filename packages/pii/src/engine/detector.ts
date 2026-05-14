/**
 * PII detection engine.
 *
 * Resolves an ordered list of `PiiPattern` against a (pre-normalized) input
 * text and returns a deduplicated `PiiMatch[]`. Three pattern shapes are
 * supported via `PiiPattern.regex` / `PiiPattern.detect` / `PiiPattern.validate`
 * — see `core/types.ts` for the contract.
 *
 * Never throws. Validator exceptions are caught and logged with the pattern
 * name and `err.name` only — never the matched text, because the match may
 * itself be PII (GDPR).
 *
 * Dedup policy: longest non-overlapping match wins. On equal length, the
 * pattern that appears earlier in the input registry wins (stable sort).
 * This prevents regressions like #1618 where the `phone` pattern's match
 * sat inside a longer `creditCard` match and the masker spliced both,
 * eating the replacement token of the second.
 */

import { REGEX_EXEC_BUDGET_MS, execWithBudget } from '../core/regex-safety';
import type { PiiMatch, PiiMatchSpan, PiiPattern } from '../core/types';

/**
 * Run one pattern against the text and return its raw spans (pre-dedup).
 *
 * `budgetMs` is threaded from `ScrubberOptions.perPatternBudgetMs` all the
 * way down to the `execWithBudget` call so admin-tunable per-pattern
 * budgets actually take effect (the scrubber used to discard the option).
 */
function resolveMatches(
  text: string,
  pattern: PiiPattern,
  budgetMs: number = REGEX_EXEC_BUDGET_MS,
): PiiMatchSpan[] {
  if (pattern.detect) {
    try {
      return pattern.detect(text);
    } catch (err) {
      console.debug(
        `[pii] detect() threw for pattern ${pattern.name}: ${
          err instanceof Error ? err.name : 'unknown'
        }`,
      );
      return [];
    }
  }

  // After the `pattern.detect` branch returns, the union narrows to
  // `PiiPatternRegex` where `regex` is required. TypeScript can't see
  // that on its own (both variants make `detect` optional via `?: never`),
  // so we capture into a local and add a runtime guard for defense in
  // depth against a malformed object that snuck past the schema.
  const regex = pattern.regex;
  if (!regex) return [];

  // `execWithBudget` clones the regex internally for `lastIndex` isolation,
  // so we pass `pattern.regex` directly — no redundant allocation here.
  const out: PiiMatchSpan[] = [];
  for (const m of execWithBudget(regex, text, budgetMs)) {
    if (pattern.validate) {
      let ok = false;
      try {
        ok = pattern.validate(m.matchedText);
      } catch (err) {
        console.debug(
          `[pii] validate() threw for pattern ${pattern.name}: ${
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
 * Without this, a `phone` match covering a 14-char prefix of a 19-char
 * `creditCard` match leaves both in the list; the masker (which splices
 * using original indices into a mutating string) sees the second range's
 * `end` pointing past where the string has shifted, and adjacent text —
 * sometimes the next replacement token entirely — gets eaten. (#1618.)
 *
 * Policy: longest match wins; on equal length, the entry inserted first
 * wins, courtesy of stable sort. The detector visits patterns in registry
 * order, so registry order is the implicit tie-breaker.
 *
 * Exported because plugin authors composing regex- and function-based
 * matches benefit from a single canonical dedup.
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

/**
 * Run every pattern against `text`, collect matches, dedup overlaps,
 * return the result.
 *
 * Note: this is a pure function. It does not normalize the input
 * (`core/normalize.ts`) and it does not validate the config — both are
 * the caller's responsibility. `scrubber.scrub()` and `scrubPii()`
 * orchestrate normalization and pattern selection on top of this.
 *
 * `budgetMs` is forwarded to every regex `execWithBudget` call. Function-
 * shaped patterns (`pattern.detect`) own their own performance contract
 * and ignore this knob.
 */
export function detectPii(
  text: string,
  patterns: ReadonlyArray<PiiPattern>,
  budgetMs: number = REGEX_EXEC_BUDGET_MS,
): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const pattern of patterns) {
    for (const span of resolveMatches(text, pattern, budgetMs)) {
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
