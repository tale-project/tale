'use client';

import { useEffect, useState } from 'react';

/**
 * Follow vertical scrolling inside the app shell, including nested panes.
 *
 * `forceCompact` is a floor, not a starting point: a page that sets it (the
 * automation canvas, so the capsule never crowds its floating Deploy/Test
 * actions) stays compact for as long as it's on screen — scrolling, a
 * breakpoint change, and `expand()` (the bar's own tap-to-expand affordance)
 * can none of them un-compact it. Without this, any one of those could win a
 * race against the page's own intent, exactly the kind of "depends what
 * triggered it" bug that keeps coming back in a different shape.
 */
export function useScrollCompact(
  resetKey: string,
  disabled = false,
  forceCompact = false,
) {
  const [compact, setCompact] = useState(forceCompact);
  useEffect(() => {
    setCompact(forceCompact);
    if (disabled || forceCompact) return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const positions = new WeakMap<Element, { top: number; travel: number }>();
    for (const element of document.querySelectorAll('.mobile-nav-shell *')) {
      positions.set(element, { top: element.scrollTop, travel: 0 });
    }
    const reset = () => setCompact(false);
    const scroll = (event: Event) => {
      const target = event.target;
      if (
        !media.matches ||
        !(target instanceof HTMLElement) ||
        !target.closest('.mobile-nav-shell') ||
        target.closest('[role="dialog"], [role="alertdialog"]') ||
        document.querySelector('.mobile-tab-bar :focus-visible')
      )
        return;
      const maximum = target.scrollHeight - target.clientHeight;
      if (maximum <= 0) return;
      const top = Math.max(0, Math.min(target.scrollTop, maximum));
      // Route outlets can mount after this effect. Their first scroll must
      // start tracking from the default origin, not from the new position
      // (which would produce zero delta forever for an unregistered pane).
      const previous = positions.get(target) ?? { top: 0, travel: 0 };
      const delta = top - previous.top;
      if (delta === 0) return;
      const travel =
        Math.sign(delta) === Math.sign(previous.travel)
          ? previous.travel + delta
          : delta;
      positions.set(target, { top, travel });
      if (top <= 8 || travel <= -12) setCompact(false);
      else if (top > 60 && travel >= 24) setCompact(true);
    };
    document.addEventListener('scroll', scroll, true);
    media.addEventListener('change', reset);
    return () => {
      document.removeEventListener('scroll', scroll, true);
      media.removeEventListener('change', reset);
    };
  }, [resetKey, disabled, forceCompact]);
  return {
    compact,
    expand: () => {
      if (!forceCompact) setCompact(false);
    },
  };
}
