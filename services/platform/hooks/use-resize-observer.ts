'use client';

import { useEffect, type RefObject, type MutableRefObject } from 'react';

type RefInput =
  | RefObject<HTMLElement | null>
  | RefObject<HTMLElement | null>[]
  | MutableRefObject<(HTMLElement | null)[]>;

/**
 * Hook that calls a callback whenever the observed element(s) resize.
 * Also optionally listens to window resize events.
 *
 * @param refs - Single ref, array of refs, or MutableRefObject with array of elements
 * @param callback - Function to call when resize occurs
 * @param options - Configuration options
 */
export function useResizeObserver(
  refs: RefInput,
  callback: () => void,
  options: {
    /** Whether to also listen to window resize events (default: false) */
    listenToWindow?: boolean;
    /** Dependencies to trigger re-observation (useful for dynamic refs) */
    deps?: unknown[];
  } = {},
) {
  const { listenToWindow = false, deps = [] } = options;

  // Window resize listener
  useEffect(() => {
    if (!listenToWindow) return;

    window.addEventListener('resize', callback);
    return () => window.removeEventListener('resize', callback);
  }, [callback, listenToWindow]);

  // ResizeObserver
  useEffect(() => {
    let validElements: HTMLElement[] = [];

    // Handle array of RefObjects
    if (Array.isArray(refs)) {
      validElements = refs
        .map((ref) => ref.current)
        .filter((el): el is HTMLElement => el !== null);
    }
    // Handle MutableRefObject<Array>
    else if ('current' in refs && Array.isArray(refs.current)) {
      validElements = refs.current.filter((el): el is HTMLElement => el !== null);
    }
    // Handle single RefObject
    else if ('current' in refs && refs.current && !Array.isArray(refs.current)) {
      validElements = [refs.current as HTMLElement];
    }

    if (validElements.length === 0) return;

    const resizeObserver = new ResizeObserver(() => {
      callback();
    });

    validElements.forEach((element) => {
      resizeObserver.observe(element);
    });

    return () => {
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback, ...deps]);
}
