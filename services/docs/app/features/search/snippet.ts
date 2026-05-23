/** Extract a short window of text from `body` centred on the most meaningful
 *  match across `terms`. "Most meaningful" = longest matched term — longer
 *  tokens carry more signal than common short ones. Falls back to the head
 *  of the body when no term matches.
 *
 *  Pure function — easy to unit-test. */
export function extractSnippet(
  body: string,
  terms: readonly string[],
  windowChars = 160,
): string {
  if (!body) return '';

  const lower = body.toLowerCase();
  // Search longest term first so a hit on "configuration" is preferred over
  // a hit on the user's literal "config" (which would always come first by
  // virtue of being a prefix of the longer term).
  const sortedTerms = [...terms]
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);

  let firstIdx = -1;
  for (const term of sortedTerms) {
    const t = term.toLowerCase();
    const idx = lower.indexOf(t);
    if (idx !== -1) {
      firstIdx = idx;
      break;
    }
  }

  if (firstIdx === -1) {
    return clampHead(body, windowChars);
  }

  const half = Math.floor(windowChars / 2);
  let start = Math.max(0, firstIdx - half);
  let end = Math.min(body.length, start + windowChars);

  // Snap to nearest word boundary so snippets don't begin/end mid-word.
  if (start > 0) {
    const space = body.indexOf(' ', start);
    if (space !== -1 && space - start < 24) start = space + 1;
  }
  if (end < body.length) {
    const space = body.lastIndexOf(' ', end);
    if (space > start) end = space;
  }

  const prefix = start > 0 ? '… ' : '';
  const suffix = end < body.length ? ' …' : '';
  return prefix + body.slice(start, end).trim() + suffix;
}

/** Lowercased, deduplicated tokens from a search query. Single-character
 *  tokens are kept so multi-token queries like "a/b config" still highlight
 *  the lone `a` and `b`. The decision of when to *run* a search is made by
 *  the caller — this helper is just normalisation. */
export function extractTerms(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}\-_]/gu, ''))
    .filter((t) => t.length >= 1);
  return Array.from(new Set(tokens));
}

function clampHead(body: string, windowChars: number): string {
  if (body.length <= windowChars) return body;
  const sliced = body.slice(0, windowChars);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut =
    lastSpace > windowChars * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return cut.trim() + ' …';
}
