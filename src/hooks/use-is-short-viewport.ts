import { useMediaQuery } from './use-media-query';

/**
 * The `short-viewport` variant's query (`globals.css`): a viewport too short
 * to hold a page's chrome and its content at once — a phone held sideways,
 * a laptop zoomed to 200 %.
 */
export const SHORT_VIEWPORT_QUERY = '(max-height: 30rem)';

/**
 * `true` where the `short-viewport:` variant applies. There a collection
 * screen's table no longer scrolls inside its own frame — the page does — so
 * a script that watches the table's scrolling (an infinite list's sentinel)
 * must watch the page instead.
 */
export function useIsShortViewport(): boolean {
  return useMediaQuery(SHORT_VIEWPORT_QUERY);
}
