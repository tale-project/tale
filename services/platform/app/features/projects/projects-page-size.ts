/**
 * How many projects one page of the projects list holds: the page the route
 * loader prefetches and the one the list subscribes with, which must match or
 * the cache key misses. A deliberate exception to `DEFAULT_LIST_PAGE_SIZE`,
 * like the logs' `LOGS_PAGE_SIZE`: the list loads its next page as it
 * scrolls, and a search or the Teams filter loads every page, so it reads the
 * page its endpoint answers by default (`PROJECT_PAGE_LIMITS`: 50, at most
 * 100) rather than twenty rows at a time.
 *
 * Its own module rather than `hooks/queries.ts`, which tests replace wholesale.
 */
export const PROJECTS_PAGE_SIZE = 50;
