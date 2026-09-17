/**
 * Sentence-boundary helpers.
 *
 * Used by `pronouns-formal` to implement the DE sentence-initial `Sie`
 * carve-out: at sentence start, `Sie` is ambiguous (third-person feminine
 * vs. formal-you) and should not be flagged.
 */

/**
 * Returns true when a regex match begins at the start of a sentence in
 * the given line (start of string OR after `.`/`!`/`?` followed by space).
 *
 * `matchIndex` is the column where the match starts.
 */
export function isCapitalisedSentenceStart(
  line: string,
  matchIndex: number,
): boolean {
  if (matchIndex === 0) return true;
  // Walk backward over whitespace to find the previous non-space char.
  let i = matchIndex - 1;
  while (i >= 0 && /\s/.test(line[i])) i--;
  if (i < 0) return true;
  const prev = line[i];
  return prev === '.' || prev === '!' || prev === '?';
}
