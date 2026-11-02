import { useMediaQuery } from './use-media-query';

/** The widest viewport, in CSS pixels, that gets the mobile layout: Tailwind's
 * `md` breakpoint starts at 768. */
export const MOBILE_MAX_WIDTH = 767;

/** Tailwind `md` breakpoint lower bound — below this is the mobile layout.
 * Docs pages switch to a screenshot's phone capture at the same width. */
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/**
 * `true` when the viewport is narrower than the `md` breakpoint (`< 768px`).
 *
 * Desktop-first: it reads `false` on the server and wherever `matchMedia`
 * cannot answer, so a docked pane renders before its mobile `Sheet` variant
 * rather than the other way round. Use it to gate the two mutually: a
 * `Sheet`'s `md:hidden` only hides its *content* via CSS — Radix still
 * portals the overlay on desktop, which intercepts clicks — so gate the
 * Sheet's `open` on this hook so it never opens above `md`.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
