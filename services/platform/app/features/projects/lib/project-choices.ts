/**
 * What a project picker offers without loading every project the caller can
 * read (#5194): the page Home's navigator reads (`NAVIGATOR_PROJECT_LIMIT`,
 * the pinned first) and, while that page does not hold every project, the
 * server's name search for what was typed. The chat seam and the projects
 * feature's hooks read through different clients; these rules are theirs
 * alike.
 */

import type { ItemOf } from '@/app/lib/backend/contract';

type ProjectChoice = Pick<
  ItemOf<'projects/queries:searchProjects'>,
  '_id' | 'archivedAt'
>;

/** How long typing settles before a picker asks the server (ms). */
export const PROJECT_SEARCH_DEBOUNCE_MS = 300;

/**
 * What a picker asks the server for: the typed name, trimmed. `null` — no
 * search — while nothing was typed, while the page has not answered, and once
 * the page holds every project, whose own filter then finds them all.
 */
export function projectSearchTerm(
  query: string,
  pageIsDone: boolean | undefined,
): string | null {
  const term = query.trim();
  return pageIsDone === false && term.length > 0 ? term : null;
}

/**
 * The page's rows, then the search hits the page lacks. An archived hit is
 * dropped, as the page drops archived projects. Answers the page's own array
 * when the hits add nothing, so a memo keyed on it holds.
 */
export function mergeProjectChoices<Row extends ProjectChoice>(
  page: readonly Row[],
  found: readonly Row[],
): readonly Row[] {
  if (found.length === 0) return page;
  const listed = new Set(page.map((row) => row._id));
  const more = found.filter(
    (row) => row.archivedAt === undefined && !listed.has(row._id),
  );
  return more.length === 0 ? page : [...page, ...more];
}
