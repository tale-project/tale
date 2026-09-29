import { useEffect, useState } from 'react';

function readInitial(query: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a CSS media query.
 *
 * Reads `matchMedia` synchronously during the first render on the client so
 * dependent components don't flicker through a default-`false` state before
 * the effect runs. Returns `false` on the server where `window` is undefined
 * — which is correct for the platform (CSR-only, no hydration mismatch).
 * Re-renders when the query's match state changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => readInitial(query));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
