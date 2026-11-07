'use client';

import { trimPathRight, useRouterState } from '@tanstack/react-router';

/**
 * The path of the page the router shows: what a navigation marks as the
 * current page, and what a frame around the outlet follows.
 *
 * A navigation sets the router's location as soon as it starts, while the
 * outlet keeps the page it shows until the next one has loaded: its code,
 * its loaders. Read from the location, a tab strip would mark the next tab
 * while the last page still stands below it. While the router loads, this
 * gives the path of the deepest match it shows instead; the router ends the
 * load and swaps the matches in one update, so the value moves with the
 * page. At rest it is the location's path. Either way it has no trailing
 * slash: an index route's match carries one, and so does an address typed
 * with one, which the router keeps.
 */
export function useShownPathname(): string {
  return useRouterState({
    select: (state) =>
      trimPathRight(
        state.isLoading
          ? (state.matches.at(-1)?.pathname ?? state.location.pathname)
          : state.location.pathname,
      ),
  });
}
