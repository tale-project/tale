'use client';

/**
 * The shared list-windowing primitive. Keep the full ordered data source;
 * render getVirtualItems(), measure each data-index row with measureElement,
 * and use getTotalSize() for the scrollable space. Stable getItemKey values
 * keep measurements attached to their entity after live updates or reorders.
 *
 * Consumers own semantics and keyboard navigation: scrollToIndex brings an
 * unmounted row into view, and rangeExtractor can retain a focused or active
 * row while the rest of the list is recycled.
 */
export {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  useVirtualizer as useVirtualList,
  type Range,
  type VirtualItem,
  type Virtualizer,
  type VirtualizerOptions,
} from '@tanstack/react-virtual';
