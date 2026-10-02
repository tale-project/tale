'use client';

import {
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';

type ResizeCallback = (entry: ResizeObserverEntry, target: Element) => void;

type RefInput =
  | RefObject<HTMLElement | null>
  | RefObject<HTMLElement | null>[]
  | MutableRefObject<(HTMLElement | null)[]>;

interface ResizeObserverOptions {
  /** Also fire on window `resize` events (default: false). */
  listenToWindow?: boolean;
  /** Dependencies that should re-attach the observer (for refs filled late). */
  deps?: unknown[];
}

function isRefInput(target: unknown): target is RefInput {
  if (Array.isArray(target)) return true;
  return (
    typeof target === 'object' &&
    target !== null &&
    'current' in target &&
    !(target instanceof Element)
  );
}

function elementsOf(target: Element | null | undefined | RefInput): Element[] {
  if (!target) return [];
  if (target instanceof Element) return [target];
  if (Array.isArray(target)) {
    return target
      .map((ref) => ref.current)
      .filter((el): el is HTMLElement => el !== null);
  }
  const { current } = target;
  if (Array.isArray(current)) {
    return current.filter((el): el is HTMLElement => el !== null);
  }
  return current ? [current] : [];
}

/**
 * Subscribe a stable callback to ResizeObserver entries.
 *
 * Two call shapes share one implementation:
 *
 *   - `useResizeObserver(element, (entry, target) => …)` — observe a single
 *     element (pass `null`/`undefined` to disable). Fires once when the
 *     observer first attaches, so initial-fit logic sees the post-layout size.
 *   - `useResizeObserver(refs, () => …, { listenToWindow, deps })` — observe
 *     one ref, an array of refs, or a ref holding an array of elements (a
 *     tab strip's item refs), optionally also on window resize; `deps`
 *     re-attaches the observer when refs are filled after the first render.
 *
 * The callback is stored in a ref so it can change every render without
 * tearing down the observer.
 */
export function useResizeObserver(
  target: Element | null | undefined,
  callback: ResizeCallback,
): void;
export function useResizeObserver(
  refs: RefInput,
  callback: () => void,
  options?: ResizeObserverOptions,
): void;
export function useResizeObserver(
  target: Element | null | undefined | RefInput,
  callback: ResizeCallback | (() => void),
  options: ResizeObserverOptions = {},
): void {
  const { listenToWindow = false, deps = [] } = options;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!listenToWindow) return undefined;
    // `listenToWindow` only exists on the ref-based overload, whose callback
    // takes no arguments — the overload contract guarantees the shape here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the overload that accepts `options`
    const handler = () => (callbackRef.current as () => void)();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [listenToWindow]);

  // Refs are read inside the effect, so the effect must re-run when the
  // caller says its refs changed; a stable string key keeps the deps array
  // a fixed length.
  const depsKey = JSON.stringify(deps);
  const refBased = isRefInput(target);

  useEffect(() => {
    const elements = elementsOf(target);
    if (elements.length === 0) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // A `() => void` callback ignores the extra arguments, so every
        // overload is served by the same call.
        callbackRef.current(entry, entry.target);
      }
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
    // `depsKey` stands in for the caller's ref contents; `refBased` toggles
    // are the only other reason the element set can change identity.
  }, [target, depsKey, refBased]);
}
