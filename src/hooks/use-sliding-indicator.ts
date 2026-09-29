'use client';

import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from 'react';

interface IndicatorBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The glide every sliding highlight shares — the rail's pill, a segmented
 * control's thumb, a panel's selection: position and size ease out over one
 * duration, opacity fades quickly. */
const GLIDE_TRANSITION =
  '[transition:transform_280ms_var(--ease-out-quint),width_280ms_var(--ease-out-quint),height_280ms_var(--ease-out-quint),opacity_150ms_ease-out] motion-reduce:transition-none';

/** While the highlight lands — its first placement, or the first after a
 * spell with nothing active — it appears where it belongs and only fades. */
const LAND_TRANSITION =
  '[transition:opacity_150ms_ease-out] motion-reduce:transition-none';

export interface SlidingIndicator<Container extends HTMLElement> {
  /** Attach to the positioned element the indicator is drawn inside. */
  readonly containerRef: (node: Container | null) => void;
  /** Position + size of the indicator; transparent while nothing is active. */
  readonly style: CSSProperties;
  /** The indicator's transition: a fade while it lands, the glide once it
   * stands somewhere — so it never slides in from the container's corner. */
  readonly transitionClassName: string;
}

/**
 * A highlight that glides to whichever item is active: the rail's selected
 * tile, a segmented control's current option, the open row of a panel. Items
 * mark themselves with `data-indicator-key`; the indicator is an absolutely
 * positioned sibling inside the container, moved with a transform so the
 * browser composites the motion instead of re-laying out the row.
 *
 * With nothing active the indicator fades out where it stood, and the next
 * active item gets it faded in on the spot rather than glided to from a
 * place the user no longer sees.
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
  const [visible, setVisible] = useState(false);
  const [gliding, setGliding] = useState(false);

  const containerRef = useCallback((node: Container | null) => {
    setContainer(node);
  }, []);

  useLayoutEffect(() => {
    const item =
      container === null || activeKey === null
        ? null
        : container.querySelector<HTMLElement>(
            `[data-indicator-key="${CSS.escape(activeKey)}"]`,
          );
    if (container === null || item === null) {
      setVisible(false);
      return undefined;
    }
    const measure = () => {
      const outer = container.getBoundingClientRect();
      const inner = item.getBoundingClientRect();
      setBox((previous) => {
        // Relative to the padding box — where an absolute child's origin
        // sits — so a bordered container does not shift the highlight.
        const next = {
          x:
            inner.left -
            outer.left -
            container.clientLeft +
            container.scrollLeft,
          y: inner.top - outer.top - container.clientTop + container.scrollTop,
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
    setVisible(true);
    // The container, its direct children and the item itself: a disclosure
    // opening above the item moves it without resizing it, but it does
    // resize the child that holds the list.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    observer.observe(item);
    return () => observer.disconnect();
  }, [container, activeKey, layoutVersion]);

  // Glide only between two places the highlight is seen at: arriving, it
  // lands and fades in, and the glide arms a frame after that paint.
  useLayoutEffect(() => {
    if (!visible) {
      setGliding(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setGliding(true));
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const style: CSSProperties =
    box === null
      ? { opacity: 0, width: 0, height: 0 }
      : {
          opacity: visible ? 1 : 0,
          width: box.width,
          height: box.height,
          transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
        };

  return {
    containerRef,
    style,
    transitionClassName: gliding ? GLIDE_TRANSITION : LAND_TRANSITION,
  };
}
