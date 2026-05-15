/**
 * PII masker — splices replacement tokens into the input text.
 *
 * Single-pass O(n) builder: matches are walked ascending and the output
 * is assembled by pushing slices of the original text plus replacement
 * tokens into an array, joined at the end. An end-to-start
 * `result.slice(0, start) + token + result.slice(end)` loop reallocates
 * the full string on every iteration — O(match_count * input_length),
 * measurable once a 50 KB paste contains many matches.
 *
 * Pure function. Input matches must come from `detectPii` (already
 * deduped); overlapping matches would corrupt the output, but the
 * detector's `dedupOverlaps` guarantees non-overlap.
 */

import type { PiiMatch } from '../core/types';

export function maskPii(text: string, matches: PiiMatch[]): string {
  if (matches.length === 0) return text;

  // `detectPii` returns ascending-start order. Re-sort defensively so the
  // function is safe to call with any post-dedup match list.
  const ordered = [...matches].sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = 0;
  for (const match of ordered) {
    // Defensive: skip overlap. `detectPii.dedupOverlaps` guarantees
    // non-overlap so this is unreachable in practice, but keeps the
    // function safe when called by plugin authors who assemble their
    // own match arrays.
    if (match.start < cursor) continue;
    parts.push(text.slice(cursor, match.start), match.replacement);
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
