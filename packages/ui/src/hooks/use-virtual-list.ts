'use client';

import { observeElementOffset, useVirtualizer } from '@tanstack/react-virtual';

/** Seed a newly attached observer before TanStack restores its offset. A
 * restored page or newly enabled window may already be far down the list. */
export const observeCurrentElementOffset: typeof observeElementOffset = (
  instance,
  callback,
) => {
  const unsubscribe = observeElementOffset(instance, callback);
  const element = instance.scrollElement;
  const { horizontal, isRtl } = instance.options;
  callback(
    element
      ? horizontal
        ? element.scrollLeft * (isRtl ? -1 : 1)
        : element.scrollTop
      : 0,
    false,
  );
  return unsubscribe;
};

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
  type Range,
  type VirtualItem,
  type Virtualizer,
  type VirtualizerOptions,
} from '@tanstack/react-virtual';

export function useVirtualList<
  TScrollElement extends Element,
  TItemElement extends Element,
>(options: Parameters<typeof useVirtualizer<TScrollElement, TItemElement>>[0]) {
  return useVirtualizer<TScrollElement, TItemElement>({
    ...options,
    observeElementOffset:
      options.observeElementOffset ?? observeCurrentElementOffset,
    initialOffset:
      options.initialOffset ??
      (() => {
        const element = options.getScrollElement();
        return element
          ? options.horizontal
            ? element.scrollLeft * (options.isRtl ? -1 : 1)
            : element.scrollTop
          : 0;
      }),
  });
}
