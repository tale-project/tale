'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

interface IndicatorBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SlidingIndicator<Container extends HTMLElement> {
  /** Attach to the positioned element the indicator is drawn inside. */
  readonly containerRef: (node: Container | null) => void;
  /** Position + size of the indicator; hidden while nothing is active. */
  readonly style: CSSProperties;
  /** False until the first placement painted — the indicator appears in
   * place on mount and only glides between later positions. */
  readonly animated: boolean;
}

/**
 * A highlight that glides to whichever item is active: the rail's selected
 * tile, a segmented control's current option. Items mark themselves with
 * `data-indicator-key`; the indicator is an absolutely positioned sibling
 * inside the container, moved with a transform so the browser composites the
 * motion instead of re-laying out the row.
 *
 * Measured, not animated by a layout engine, because the app loads the lean
 * animation bundle — shared-element transitions are not in it, and a CSS
 * transform transition gives the same glide for a fraction of the weight.
 */
export function useSlidingIndicator<Container extends HTMLElement>(
  activeKey: string | null,
  /** Anything that can move the active item without changing its key — a
   * list that grew above it, a label that changed width. */
  layoutVersion: unknown = null,
): SlidingIndicator<Container> {
  const [container, setContainer] = useState<Container | null>(null);
  const [box, setBox] = useState<IndicatorBox | null>(null);
  const [animated, setAnimated] = useState(false);
  const placedOnce = useRef(false);

  const containerRef = useCallback((node: Container | null) => {
    setContainer(node);
  }, []);

  useLayoutEffect(() => {
    if (container === null || activeKey === null) {
      setBox(null);
      return undefined;
    }
    const item = container.querySelector<HTMLElement>(
      `[data-indicator-key="${CSS.escape(activeKey)}"]`,
    );
    if (item === null) {
      setBox(null);
      return undefined;
    }
    const measure = () => {
      const outer = container.getBoundingClientRect();
      const inner = item.getBoundingClientRect();
      setBox((previous) => {
        const next = {
          x: inner.left - outer.left + container.scrollLeft,
          y: inner.top - outer.top + container.scrollTop,
          width: inner.width,
          height: inner.height,
        };
        return previous !== null &&
          previous.x === next.x &&
          previous.y === next.y &&
          previous.width === next.width &&
          previous.height === next.height
          ? previous
          : next;
      });
    };
    measure();
    // The container, its direct children and the item itself: a disclosure
    // opening above the item moves it without resizing it, but it does
    // resize the child that holds the list.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    observer.observe(item);
    return () => observer.disconnect();
  }, [container, activeKey, layoutVersion]);

  // Arm the transition one frame after the first placement, so the first
  // paint lands in place rather than sliding in from the corner.
  useLayoutEffect(() => {
    if (box === null || placedOnce.current) return undefined;
    placedOnce.current = true;
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [box]);

  const style: CSSProperties =
    box === null
      ? { opacity: 0, width: 0, height: 0 }
      : {
          opacity: 1,
          width: box.width,
          height: box.height,
          transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
        };

  return { containerRef, style, animated };
}
