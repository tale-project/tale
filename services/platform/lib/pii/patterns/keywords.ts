/**
 * Keyword-to-regex composition shared by every locale-composed pattern
 * (phone, cvc, date-of-birth, address).
 */

import { escapeRegExp } from '../core/regex-safety';

/**
 * Merge one or more keyword lists into a single regex alternation:
 * de-duplicated, longest-first (JavaScript alternation is leftmost-first,
 * so multi-word keywords must precede their substrings), each keyword
 * regex-escaped — keyword data is literal text, and this composer is the
 * boundary that turns literals into regex source.
 *
 * An empty union returns `(?!)` — a regex that never matches — so calling
 * code can compose unconditionally.
 */
export function composeKeywordAlternation(
  keywordLists: ReadonlyArray<readonly string[] | undefined>,
): string {
  const merged = new Set<string>();
  for (const list of keywordLists) {
    if (!list) continue;
    for (const kw of list) {
      if (kw.length > 0) merged.add(kw);
    }
  }
  if (merged.size === 0) return '(?!)';
  return [...merged]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}
