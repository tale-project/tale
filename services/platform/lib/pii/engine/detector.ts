/**
 * Detection core — runs an ordered pattern list over pre-normalized text
 * and returns a deduplicated `PiiMatch[]`.
 *
 * Never throws. Validator and detect exceptions are caught and logged with
 * the pattern name and the error's NAME only — never the matched text or
 * message, because either may itself contain PII.
 *
 * Dedup policy: longest non-overlapping match wins; on equal length the
 * pattern visited first wins (stable sort + registry order). Without this,
 * a shorter match nested inside a longer one leaves both in the list and
 * the splicing masker eats adjacent text — including, in the worst case,
 * the next replacement token.
 */

import { REGEX_EXEC_BUDGET_MS, execWithBudget } from '../core/regex-safety';
import type { PiiMatch, PiiMatchSpan, PiiPattern } from '../core/types';

/**
 * Raw (pre-dedup) spans for one pattern. `budgetMs` reaches every regex
 * exec loop; function-shaped patterns own their own performance contract
 * and ignore it.
 */
function resolveMatches(
  text: string,
  pattern: PiiPattern,
  budgetMs: number,
): PiiMatchSpan[] {
  if (pattern.detect) {
    try {
      return pattern.detect(text);
    } catch (err) {
      console.debug(
        `[pii] detect() threw for pattern ${pattern.name}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      return [];
    }
  }

  // Past the detect branch the union narrows to the regex variant, but
  // both variants type their other field via `?: never`, so capture and
  // guard — also defense in depth against a malformed object.
  const regex = pattern.regex;
  if (!regex) return [];

  const out: PiiMatchSpan[] = [];
  for (const m of execWithBudget(regex, text, budgetMs)) {
    if (pattern.validate) {
      let ok = false;
      try {
        ok = pattern.validate(m.matchedText);
      } catch (err) {
        console.debug(
          `[pii] validate() threw for pattern ${pattern.name}: ${err instanceof Error ? err.name : 'unknown'}`,
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
 * Merge overlapping matches into a non-overlapping set: sort by ascending
 * start, then descending length (so the longest match at an offset wins),
 * keep a span only when it starts at or past the previous kept end — or
 * replace the previous one when it is strictly longer.
 */
function dedupOverlaps(matches: PiiMatch[]): PiiMatch[] {
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
 * Run every pattern over `text`, collect and dedup matches. Pure: the
 * caller owns normalization and clamping (`createScrubber` and
 * `createTokenizer` orchestrate both on top of this).
 */
export function detectPii(
  text: string,
  patterns: ReadonlyArray<PiiPattern>,
  budgetMs: number = REGEX_EXEC_BUDGET_MS,
): PiiMatch[] {
  if (text.length === 0) return [];

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
