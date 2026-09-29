/**
 * "Did you mean" for a documentation 404: rank a site's pages by how close
 * their slug is to the path a reader asked for. Slugs, not routes — a locale
 * or mount prefix would otherwise make every page look equally similar.
 */

export interface SuggestionCandidate {
  /** Path relative to the site's content root, e.g. `platform/chat/basics`. */
  slug: string;
}

/** Iterative Levenshtein distance between two short strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Score how similar `candidate` is to `query` (lower is closer). */
function score(query: string, candidate: string): number {
  if (candidate.includes(query) || query.includes(candidate)) return 0;
  // Compare the last path segment first — usually the most discriminating.
  const queryLeaf = query.split('/').pop() ?? query;
  const candidateLeaf = candidate.split('/').pop() ?? candidate;
  return Math.min(
    levenshtein(queryLeaf, candidateLeaf),
    levenshtein(query, candidate),
  );
}

/**
 * The `max` candidates closest to `query`, closest first. An empty query —
 * the reader landed on the site root's 404 — keeps the navigation order.
 */
export function suggestPages<T extends SuggestionCandidate>(
  query: string,
  candidates: readonly T[],
  max = 4,
): T[] {
  if (!query) return candidates.slice(0, max);
  return candidates
    .map((candidate) => ({ candidate, s: score(query, candidate.slug) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, max)
    .map((entry) => entry.candidate);
}

/**
 * A readable label for a slug when the page has no title to offer, e.g.
 * `platform/chat/basics` → `Platform / Chat / Basics`.
 */
export function slugLabel(slug: string): string {
  return slug
    .replace(/\/index$/, '')
    .split('/')
    .map((part) =>
      part
        .split('-')
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(' '),
    )
    .join(' / ');
}
