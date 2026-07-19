import { useEffect, useState } from 'react';

/** Tailwind `lg` breakpoint lower bound — from here up there is room for the
 *  expanded sidebar beside the content. */
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Reactive viewport check for the wide-desktop layout (`lg`+). SSR-safe:
 * returns `false` on the server, then syncs on mount and on resize.
 *
 * The unified sidebar uses this to gate its expandability: between `md` and
 * `lg` it is pinned to the icon rail (no toggle), and only from `lg` up does
 * the persisted expand/collapse preference apply.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
