import { useEffect, useState } from 'react';

/** Tailwind `md` breakpoint lower bound — below this is the mobile layout. */
const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Reactive viewport check for the mobile layout (< `md`). SSR-safe: returns
 * `false` on the server (desktop-first), then syncs on mount and on resize.
 *
 * Use to mutually gate a desktop docked pane vs. its mobile `Sheet` variant:
 * a `Sheet`'s `md:hidden` only hides its *content* via CSS — Radix still
 * portals the Dialog overlay/backdrop on desktop, which intercepts clicks. Gate
 * the Sheet's `open` on this hook so it never opens above `md`.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isMobile;
}
