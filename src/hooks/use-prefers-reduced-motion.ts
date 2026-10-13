import { useMediaQuery } from './use-media-query';

/** The media query behind the user's "reduce motion" setting. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the user asked for less motion. CSS reaches most animation through
 * `motion-safe:` / `motion-reduce:` and the global reduced-motion rule; read
 * this where motion runs from script instead — a React Flow viewport ease,
 * a Web Animations API call, a caret's blink — so it stops there too.
 * Follows the setting live.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

/** The same answer outside React, read once (false without a window). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}
