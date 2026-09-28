/**
 * Rows per page of the Audit and Error logs — the listings' first backend
 * request and the window their table renders before loading more, so the first
 * paint is exactly one server page. The one deliberate exception to
 * `DEFAULT_LIST_PAGE_SIZE`, which every other settings list takes.
 *
 * What sets the logs apart is how they are read: an unbounded, append-only
 * trail that every action in the organization extends, read in time order by
 * scrolling back through it to reconstruct what happened. Scrolling is the
 * whole reading, so the larger page buys fewer round trips per stretch of
 * history. The Trash shares the logs' full-page sticky frame but not that
 * reading — a bin that retention fills and purges, listed category by
 * category, where an admin filters down to the one record to restore — so it
 * takes the shared size.
 *
 * Its own module rather than `hooks/queries.ts`, which tests replace wholesale.
 */
export const LOGS_PAGE_SIZE = 30;
