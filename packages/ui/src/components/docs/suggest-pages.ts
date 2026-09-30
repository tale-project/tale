/**
 * "Did you mean" for a documentation 404: the site's pages ranked by how
 * close they are to the path a reader asked for. Slugs, not routes — a
 * locale or mount prefix would otherwise make every page look equally
 * similar. The ranking is the near-miss scorer's (`./near-miss`), the same
 * one a docs server uses to redirect a guessed address, so the list and the
 * redirect never disagree about which page is closest.
 */

import {
  buildNearMissIndex,
  rankNearMisses,
  type NearMissNavGroup,
} from './near-miss';
import { slugRoute } from './redirects';

export interface SuggestionCandidate {
  /** Path relative to the site's content root, e.g. `platform/chat/basics`. */
  slug: string;
  /** The page's titles in every locale it ships: a translated or
   *  title-shaped guess (`mitglieder-und-rollen`) finds the page by them. */
  titles?: readonly string[];
}

/**
 * The `max` candidates closest to `query`, closest first. An empty query —
 * the reader landed on the site root's 404 — keeps the navigation order.
 * `groups` is the site's sidebar, so a folder the reader spelled as a group
 * label (`verwaltung/…`) ranks the pages under that group first.
 */
export function suggestPages<T extends SuggestionCandidate>(
  query: string,
  candidates: readonly T[],
  max = 4,
  groups: readonly NearMissNavGroup[] = [],
): T[] {
  if (!query) return candidates.slice(0, max);
  const byRoute = new Map<string, T>();
  for (const candidate of candidates) {
    const route = slugRoute(candidate.slug);
    if (!byRoute.has(route)) byRoute.set(route, candidate);
  }
  const index = buildNearMissIndex(
    [...byRoute].map(([route, candidate]) => ({
      route,
      titles: candidate.titles ?? [],
    })),
    groups,
  );
  return rankNearMisses(query, index)
    .slice(0, max)
    .flatMap(({ route }) => {
      const candidate = byRoute.get(route);
      return candidate ? [candidate] : [];
    });
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
