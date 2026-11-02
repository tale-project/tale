/**
 * The shell's `md` breakpoint: below it the tab bar replaces the rail and a
 * section's panel is hidden. It is the query `useIsMobile` asks, for the one
 * place that must decide before anything renders (a route's `beforeLoad`).
 */
const PHONE_QUERY = '(max-width: 767px)';

export function isPhoneViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(PHONE_QUERY).matches
  );
}
