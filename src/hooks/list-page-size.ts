/**
 * How many rows a list shows before it loads more on scroll. A host that
 * primes a backend page from a route loader asks for this many, so the first
 * paint is exactly the window the table renders. A module of its own: a route
 * loader loads with every page, and reading the size through `useListPage`
 * brought the table code along.
 */
export const DEFAULT_LIST_PAGE_SIZE = 20;
