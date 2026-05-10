import { useEffect, useRef } from 'react';

type ResizeCallback = (entry: ResizeObserverEntry, target: Element) => void;

/**
 * Subscribe a stable callback to ResizeObserver entries on the given element.
 *
 * The callback is stored in a ref so it can change every render without
 * tearing down the observer; only `target` toggles re-create the observer.
 * Pass `null`/`undefined` to disable. The callback fires once when the
 * observer first attaches (per the ResizeObserver spec) — useful for
 * initial-fit logic that needs the post-layout size.
 *
 * Example:
 * ```ts
 * const ref = useRef<HTMLDivElement>(null);
 * useResizeObserver(ref.current, (entry) => {
 *   setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
 * });
 * ```
 */
export function useResizeObserver<T extends Element>(
  target: T | null | undefined,
  callback: ResizeCallback,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!target) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        callbackRef.current(entry, entry.target);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [target]);
}
