import { useMediaQuery } from './use-media-query';

/** Tailwind `md` breakpoint lower bound — below this is the mobile layout. */
const MOBILE_QUERY = '(max-width: 767px)';

/**
 * `true` when the viewport is narrower than the `md` breakpoint (`< 768px`).
 *
 * Desktop-first: it reads `false` on the server and wherever `matchMedia`
 * cannot answer, so a docked pane renders before its mobile `Sheet` variant
 * rather than the other way round. Use it to gate the two mutually: a
 * `Sheet`'s `md:hidden` only hides its *content* via CSS — Radix still
 * portals the overlay on desktop, which intercepts clicks — so gate the
 * Sheet's `open` on this hook so it never opens above `md`. For the
 * three-way scale see {@link useBreakpoint}.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
