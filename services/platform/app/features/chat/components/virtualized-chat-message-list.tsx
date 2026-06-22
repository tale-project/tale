'use client';

import { Stack } from '@tale/ui/layout';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import type { ChatItem } from '../hooks/use-merged-chat-items';

interface VirtualizedChatMessageListProps {
  /** Message items (chronological). Approvals/thinking are rendered in `footer`. */
  items: ChatItem[];
  /** The scroll container owned by useChatScroll / ChatInterface. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Renders a single item (delegates to ChatMessages' renderItemWithDivider). */
  renderItem: (item: ChatItem, index: number) => ReactNode;
  /** Non-virtualized content above the list (e.g. the "load older" button). */
  header?: ReactNode;
  /** Non-virtualized content below the list (thinking indicator, approvals). */
  footer?: ReactNode;
  /** aria-labelledby target id for the log region. */
  labelId: string;
}

/**
 * Windowed message list (EXPERIMENTAL, opt-in via
 * `localStorage.tale_virtualized_messages='1'`). Renders only the message
 * bubbles near the viewport, absolutely positioned within a total-height
 * spacer, with dynamic per-item measurement. Reuses ChatInterface's existing
 * scroll container (`containerRef`) so the hardened stick-to-bottom / branch /
 * load-more behavior in `useChatScroll` continues to drive scrolling — this
 * only changes WHICH bubbles are in the DOM.
 *
 * NOTE: needs live-browser validation (scroll offset / dynamic measurement /
 * streaming growth can only be tuned against real layout). The non-virtualized
 * path in ChatMessages remains the default.
 */
export function VirtualizedChatMessageList({
  items,
  containerRef,
  renderItem,
  header,
  footer,
  labelId,
}: VirtualizedChatMessageListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Offset of the list within the scroll element's CONTENT. react-virtual maps
  // scrollTop (relative to the scroll element) onto item starts via this, so it
  // must be the distance from the scroll element's content origin to the list —
  // NOT `offsetTop` (which is relative to whatever ancestor is the offsetParent
  // and would include page chrome above the scroll viewport). Measured after
  // layout (when both refs exist) and re-measured when the header above the
  // list resizes (e.g. the load-more button↔spinner swap, which doesn't change
  // items.length nor the scroll container's box, so observing the log wrapper
  // is what catches it).
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current;
      const sc = containerRef.current;
      if (!el || !sc) return;
      const next =
        el.getBoundingClientRect().top -
        sc.getBoundingClientRect().top +
        sc.scrollTop;
      setScrollMargin((prev) => (prev === next ? prev : next));
    };
    measure();
    const sc = containerRef.current;
    if (!sc) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    // The role=log wrapper encloses the header above the list; its box grows
    // when the header content swaps. measure() only reads what's ABOVE the list
    // and early-returns on no-change, so list-height-driven fires are no-ops.
    const wrap = listRef.current?.parentElement;
    if (wrap) ro.observe(wrap);
    return () => ro.disconnect();
  }, [containerRef, items.length]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 140,
    overscan: 6,
    // Raw key — matches ChatMessages.renderMessage's reactKey in virtualized
    // mode (it uses the raw key there too), so the inner bubble key and this
    // wrapper key are always identical. The pending→real swap remeasures one
    // row (the send forces a scroll-to-bottom so it's in-window anyway).
    getItemKey: (index) => {
      const it = items[index];
      return it.type === 'message' ? it.data.key : `item-${index}`;
    },
    scrollMargin,
  });
  // We deliberately DO NOT override shouldAdjustScrollPositionOnItemSizeChange.
  // virtual-core's built-in default — `itemStart < scrollOffset +
  // scrollAdjustments && scrollDirection !== 'backward'` — only compensates for
  // ABOVE-viewport items and only when the user is NOT scrolling up, via a
  // RELATIVE scrollAdjustments delta. That is exactly the anti-jump behavior we
  // want when an off-screen-above row gets its first real measurement
  // (replacing the 140px estimate) while the user has scrolled up to read
  // history. It does NOT collide with useChatScroll: stick-to-bottom pins via
  // container.scrollTo(scrollHeight) gated on pinnedRef (false after a
  // scroll-up), and the load-more anchor is gated on row-count growth (a
  // same-row remeasure doesn't trigger it). Forcing the predicate to false (a
  // prior approach) removed this compensation and reintroduced viewport jumps
  // on scroll-up during lazy measurement.

  const virtualItems = virtualizer.getVirtualItems();

  return (
    // role=log WITHOUT aria-live: windowing mounts/unmounts history bubbles as
    // the user scrolls, and a polite live region here would announce that churn.
    // The stable footer (streaming response / thinking indicator) carries the
    // live region instead, so only genuinely-new content is announced.
    <Stack
      gap={0}
      className="mx-auto w-full max-w-(--chat-max-width) [overflow-anchor:none]"
      role="log"
      aria-labelledby={labelId}
    >
      {header}
      <div
        ref={listRef}
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((vItem) => (
          <div
            key={vItem.key}
            data-index={vItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vItem.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {renderItem(items[vItem.index], vItem.index)}
          </div>
        ))}
      </div>
      {/* The footer composes its OWN scoped aria-live region around just the
          thinking affordance (see ChatMessages). We must NOT wrap it again here
          or the approval card's internal live region would nest inside ours. */}
      {footer}
    </Stack>
  );
}
