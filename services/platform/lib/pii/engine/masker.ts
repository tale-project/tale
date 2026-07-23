/**
 * One-way masker — splices each match's replacement token into the text.
 *
 * Single forward pass: slices of the original text and replacement tokens
 * are pushed into an array and joined once, O(n) — a string-splice loop
 * would reallocate the whole string per match. Matches must be non-
 * overlapping (the detector's dedup guarantees it); overlaps encountered
 * anyway are skipped defensively so hand-assembled match lists stay safe.
 */

import type { PiiMatch } from '../core/types';

export function maskPii(text: string, matches: PiiMatch[]): string {
  if (matches.length === 0) return text;

  // detectPii returns ascending-start order; re-sort defensively so any
  // post-dedup match list is acceptable.
  const ordered = [...matches].sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = 0;
  for (const match of ordered) {
    if (match.start < cursor) continue;
    parts.push(text.slice(cursor, match.start), match.replacement);
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
