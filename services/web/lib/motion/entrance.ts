import { useReducedMotion } from 'framer-motion';

// Stamped when the client bundle first evaluates. Components that mount
// within the window belong to the initial page load; anything mounting
// later is an SPA navigation remount.
const BOOT_MS = typeof performance === 'undefined' ? 0 : performance.now();
const ENTRANCE_WINDOW_MS = 2500;

/**
 * True while the initial page load is still settling. Entrance animations
 * (fade-ups, scroll reveals, demo timelines starting from beat 0) are a
 * first-impression effect — replaying them on every route change makes
 * navigation read as page flicker, so blocks consult this window instead
 * of animating on every mount.
 */
export function withinEntranceWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return performance.now() - BOOT_MS < ENTRANCE_WINDOW_MS;
}

/**
 * Whether a block should skip its entrance animation: on the server (the
 * prerendered HTML must be fully visible without JS), for reduced-motion
 * users, and on every mount after the initial-load window (SPA
 * navigations). When this returns true, pass `initial={false}` and a
 * zero-duration transition.
 */
export function useSkipEntrance(): boolean {
  const reduceMotion = useReducedMotion();
  if (typeof window === 'undefined') return true;
  return (reduceMotion ?? false) || !withinEntranceWindow();
}
