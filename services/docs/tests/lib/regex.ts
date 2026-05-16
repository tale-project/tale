/**
 * Reusable regex primitives.
 *
 * The two duplicated patterns across the old test files were `escapeRegex`
 * and the word-boundary shape `(^|[^A-Za-z])TERM(?![A-Za-z])`. The latter
 * exists because `\b` is unreliable around umlauts and accented characters,
 * which DE and FR both have. We hand-roll the boundary with a character class
 * so `Ärger` doesn't accidentally match inside `Maerger`.
 */

/** Escape every metacharacter in a string so it can be embedded in a `RegExp`
 *  literal without surprises. */
export function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Build the boundary-wrapped pattern for an English-only term. The boundary
 * uses `[^A-Za-z]` rather than `\b` so adjacent punctuation, parentheses, and
 * markdown markers (`*`, `_`) terminate the match cleanly.
 *
 * The pattern reads `(^|[^A-Za-z])TERM(?![A-Za-z])`. The leading capture group
 * lets the caller's regex match against masked text without losing the
 * preceding character to the match.
 */
export function wordBoundary(inner: string): string {
  return `(^|[^A-Za-z])${inner}(?![A-Za-z])`;
}

/**
 * Same shape as `wordBoundary` but the boundary set includes German diacritics
 * and `ß` (which behaves as a letter in German). Use this for any DE term —
 * `Größe` would otherwise match inside `Großbritannien` because the second
 * `ß` is treated as a non-letter by the ASCII-only boundary.
 */
export function wordBoundaryDe(inner: string): string {
  return `(^|[^A-Za-zÄÖÜäöüß])${inner}(?![A-Za-zÄÖÜäöüß])`;
}

/** French boundary — accented Latin letters that appear in normal FR prose. */
export function wordBoundaryFr(inner: string): string {
  return `(^|[^A-Za-zÀ-ÖØ-öø-ÿ])${inner}(?![A-Za-zÀ-ÖØ-öø-ÿ])`;
}
