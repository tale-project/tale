/**
 * PII masker — splices replacement tokens into the input text.
 *
 * Works end-to-start so that index-based slices don't have to be
 * re-computed as the string shrinks (each replacement potentially shortens
 * the string by a different amount).
 *
 * Pure function. Input matches must come from `detectPii` (already
 * deduped); overlapping matches would corrupt the output, but the
 * detector's `dedupOverlaps` guarantees non-overlap.
 */

import type { PiiMatch } from '../core/types';

export function maskPii(text: string, matches: PiiMatch[]): string {
  const sorted = [...matches].sort((a, b) => b.start - a.start);

  let result = text;
  for (const match of sorted) {
    result =
      result.slice(0, match.start) +
      match.replacement +
      result.slice(match.end);
  }

  return result;
}
