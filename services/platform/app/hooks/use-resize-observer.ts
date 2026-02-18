'use client';

import {
  useEffect,
  useRef,
  type RefObject,
  type MutableRefObject,
} from 'react';

type RefInput =
  | RefObject<HTMLElement | null>
  | RefObject<HTMLElement | null>[]
  | MutableRefObject<(HTMLElement | null)[]>;

/**
 * Hook that calls a callback whenever the observed element(s) resize.
 * Also optionally listens to window resize events.
 *
 * The callback is stored in a ref so the observer remains stable regardless of
 * whether the caller wraps it with useCallback.
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
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  // Window resize listener
  useEffect(() => {
    if (!listenToWindow) return;

    const handler = () => callbackRef.current();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [listenToWindow]);

  // Serialize deps to a stable string key so the effect re-runs when deps change
  const depsKey = JSON.stringify(deps);

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
      validElements = refs.current.filter(
        (el): el is HTMLElement => el !== null,
      );
    }
    // Handle single RefObject
    else if (
      'current' in refs &&
      refs.current &&
      !Array.isArray(refs.current)
    ) {
      validElements = [refs.current];
    }

    if (validElements.length === 0) return;

    const resizeObserver = new ResizeObserver(() => {
      callbackRef.current();
    });

    validElements.forEach((element) => {
      resizeObserver.observe(element);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [refs, depsKey]);
}
