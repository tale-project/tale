import { z } from 'zod';

/** The most of a search an address keeps: a search is a few words. */
export const MAX_QUERY_LENGTH = 200;

/**
 * The `q` of an address: what is typed in the search box of a list, so a reload
 * and a link keep the view. The router reads a value that looks like a number
 * as one (`?q=8080` is 8080), so it is turned back into the text it was; a
 * value that is no text is dropped, and a long one is cut short. An address
 * somebody typed, or kept from another version, still opens the page.
 */
export const queryParamSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).slice(0, MAX_QUERY_LENGTH))
  .optional()
  .catch(undefined);

/** The search an address says, or `undefined` for none. */
export function queryOfAddress(value: unknown): string | undefined {
  const query = queryParamSchema.parse(value);
  return query === '' ? undefined : query;
}

/**
 * A change to what a list shows (its search, its filters), as the options of a
 * navigation. The part lays over the address as it is, so a search being typed
 * is not lost to a filter being chosen, nor the other way round. The entry is
 * replaced: a view is a way of looking at the page, and the back button leaves
 * it. The page keeps its scroll: the rows scroll in the table.
 */
export function viewChange<Part extends object>(part: Part) {
  return {
    search: <Search extends object>(previous: Search) => ({
      ...previous,
      ...part,
    }),
    replace: true,
    resetScroll: false,
  } as const;
}

/** The search box changed: the address says it, or says nothing for an empty box. */
export function queryChange(text: string) {
  return viewChange({ q: text === '' ? undefined : text });
}
