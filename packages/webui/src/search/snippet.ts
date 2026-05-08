/** Extract a short window of text from `body` centred on the first match
 *  for any of the supplied `terms`. Falls back to the head of the body when
 *  no term matches.
 *
 *  Pure function — easy to unit-test. */
export function extractSnippet(
  body: string,
  terms: readonly string[],
  windowChars = 160,
): string {
  if (!body) return '';

  const lower = body.toLowerCase();
  let firstIdx = -1;
  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    const idx = lower.indexOf(t);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
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

/** Lowercased, deduplicated, length-filtered tokens from a search query —
 *  used both as MiniSearch input and as highlight/snippet pivots. */
export function extractTerms(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}\-_]/gu, ''))
    .filter((t) => t.length >= 2);
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
