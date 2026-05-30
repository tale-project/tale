'use client';

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
  // layout (when both refs exist) and re-measured when the header resizes.
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
    return () => ro.disconnect();
    // items.length: the load-more header can appear/disappear, shifting the list.
  }, [containerRef, items.length]);

  // Stabilize the last user message's key across the pending→real swap so the
  // virtualizer doesn't drop its measurement / remount the wrapper at send time.
  // Mirrors ChatMessages.renderMessage's reactKey so the inner bubble key and
  // this outer wrapper key stay identical (in-place update, no teardown).
  let lastUserKey: string | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'message' && it.data.role === 'user') {
      lastUserKey = it.data.key;
      break;
    }
  }
  const prevPendingKeyRef = useRef<string | null>(null);
  const keyFor = (item: ChatItem, index: number): string => {
    if (item.type !== 'message') return `item-${index}`;
    let key = item.data.key;
    if (item.data.key === lastUserKey) {
      if (item.data.key.startsWith('pending-')) {
        prevPendingKeyRef.current = item.data.key;
      } else if (prevPendingKeyRef.current) {
        key = prevPendingKeyRef.current;
      }
    }
    return key;
  };

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 140,
    overscan: 6,
    getItemKey: (index) => keyFor(items[index], index),
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      className="mx-auto flex w-full max-w-(--chat-max-width) flex-col"
      role="log"
      aria-live="polite"
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
      {footer}
    </div>
  );
}
