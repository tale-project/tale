'use client';

import {
  defaultRangeExtractor,
  observeElementOffset,
  type PartialKeys,
  type Range,
  type ReactVirtualizerOptions,
  type ScrollToOptions,
  type VirtualItem,
  useVirtualizer,
} from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
} from 'react';

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

/** Options retained by row-windowing consumers that use the compatibility view. */
export interface UseVirtualListOptions {
  count: number;
  getScrollElement: () => Element | null;
  /** Stable identity, so measured heights follow a row through sorting. */
  getItemKey?: (index: number) => string | number;
  estimateSize: (index: number) => number;
  /** Lists this small render every row in the compatibility `items` view. */
  threshold?: number;
  /** Keep active or dragged rows mounted, along with their neighbours. */
  pinnedIndices?: readonly number[];
}

export interface VirtualListItem extends Omit<VirtualItem, 'key'> {
  key: string | number;
  /** Render an aria-hidden spacer of this height immediately before the row. */
  paddingBefore: number;
}

type LegacyOptions = {
  threshold?: number;
  pinnedIndices?: readonly number[];
};

type VirtualListResult<
  TScrollElement extends Element,
  TItemElement extends Element,
> = ReturnType<typeof useVirtualizer<TScrollElement, TItemElement>> & {
  /** Compatibility row window for lists authored before the direct TanStack API. */
  items: VirtualListItem[];
  /** Final compatibility spacer after the rendered rows. */
  paddingAfter: number;
  /** Whether the compatibility row view is windowed. */
  virtualized: boolean;
  /** Compatibility focus bridge for portaled controls inside a row. */
  onFocusCapture: FocusEventHandler<HTMLElement>;
  onBlurCapture: FocusEventHandler<HTMLElement>;
  /** Total height of the compatibility row view. */
  totalSize: number;
};

const INITIAL_RECT = { width: 0, height: 600 };
const NO_PINS: readonly number[] = [];

/**
 * The shared list-windowing primitive.
 *
 * New consumers use the TanStack Virtualizer surface directly
 * (`getVirtualItems`, `getTotalSize`, and `measureElement`). Older consumers
 * still receive the flow-preserving `items`/spacer view. Keeping both surfaces
 * here lets collection screens migrate independently without shipping two
 * competing measurement implementations.
 */
export function useVirtualList<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: PartialKeys<
    ReactVirtualizerOptions<TScrollElement, TItemElement>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  > &
    LegacyOptions,
): VirtualListResult<TScrollElement, TItemElement> {
  const count = options.count;
  const optionGetItemKey = options.getItemKey;
  const getItemKey = useCallback(
    (index: number): string | number => {
      const key = optionGetItemKey?.(index) ?? index;
      return typeof key === 'bigint' ? key.toString() : key;
    },
    [optionGetItemKey],
  );
  const threshold = options.threshold ?? 100;
  const pinnedIndices = options.pinnedIndices ?? NO_PINS;
  const compatibilityVirtualized = count > threshold;
  const hasExplicitCompatibilityMode =
    options.threshold !== undefined || options.pinnedIndices !== undefined;
  const focusedRow = useRef<{ key: string | number; index: number } | null>(
    null,
  );
  const blurVersion = useRef(0);
  const blurFrame = useRef(0);
  const [focusedIndexState, setFocusedIndexState] = useState<number | null>(
    null,
  );
  const rowElements = useRef(new Map<string | number, HTMLElement>());
  const currentOptions = useRef({ count, getItemKey });
  const latestCount = useRef(count);
  const latestGetItemKey = useRef(getItemKey);
  latestCount.current = count;
  latestGetItemKey.current = getItemKey;

  useLayoutEffect(() => {
    currentOptions.current = { count, getItemKey };
  }, [count, getItemKey]);

  const focusedIndex = useMemo(() => {
    if (focusedIndexState === null) return null;
    if (
      focusedIndexState >= 0 &&
      focusedIndexState < count &&
      getItemKey(focusedIndexState) === focusedRow.current?.key
    ) {
      return focusedIndexState;
    }
    const key = focusedRow.current?.key;
    if (key === undefined) return null;
    for (let index = 0; index < count; index++) {
      if (getItemKey(index) === key) return index;
    }
    return null;
  }, [count, getItemKey, focusedIndexState]);

  const pinsKey = pinnedIndices.join(',');
  const rangeExtractor = useMemo(() => {
    const userRangeExtractor = options.rangeExtractor;
    const hasPins = pinsKey !== '' || focusedIndex !== null;
    if (!hasPins) return userRangeExtractor;
    const pins = pinsKey === '' ? [] : pinsKey.split(',').map(Number);
    if (focusedIndex !== null) pins.push(focusedIndex);
    return (range: Range) => {
      const indices = new Set(
        (userRangeExtractor ?? defaultRangeExtractor)(range),
      );
      for (const pin of pins) {
        if (!Number.isInteger(pin) || pin < 0 || pin >= range.count) continue;
        for (let index = pin - 1; index <= pin + 1; index++) {
          if (index >= 0 && index < range.count) indices.add(index);
        }
      }
      return [...indices].sort((a, b) => a - b);
    };
  }, [focusedIndex, options.rangeExtractor, pinsKey]);

  // TanStack callers control virtualization through `enabled`. Compatibility
  // callers control it through `threshold`; the latter must not make a modern
  // caller's small list disappear from getVirtualItems().
  const enabled = hasExplicitCompatibilityMode
    ? compatibilityVirtualized
    : options.enabled;
  const measurementEnabled = hasExplicitCompatibilityMode
    ? compatibilityVirtualized
    : true;
  const {
    threshold: _threshold,
    pinnedIndices: _pinnedIndices,
    ...tanstackOptions
  } = options;
  const virtualizer = useVirtualizer<TScrollElement, TItemElement>({
    ...tanstackOptions,
    enabled,
    rangeExtractor,
    initialRect: options.initialRect ?? INITIAL_RECT,
    useAnimationFrameWithResizeObserver:
      options.useAnimationFrameWithResizeObserver ?? true,
    observeElementOffset:
      options.observeElementOffset ??
      (options.initialOffset === undefined
        ? observeCurrentElementOffset
        : observeElementOffset),
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
  useLayoutEffect(() => {
    const previous = virtualizer.shouldAdjustScrollPositionOnItemSizeChange;
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
      item,
      _delta,
      instance,
    ) => {
      const element = instance.scrollElement;
      if (!element || instance.scrollOffset === null) return false;
      const offset = instance.scrollOffset + instance.scrollAdjustments;
      const liveOffset = Math.max(
        0,
        Math.min(offset, element.scrollHeight - element.clientHeight),
      );
      // A queued resize can run after a scroll restore but before its native
      // scroll event. Compensating from the old offset would undo that restore.
      if (Math.abs(element.scrollTop - liveOffset) >= 1.5) return false;

      // Retain TanStack's default anchoring: first measurements above the fold,
      // then only fully above-fold resizes while not scrolling backward.
      const previousSize = instance.itemSizeCache.get(item.key);
      return previousSize === undefined
        ? item.start < offset
        : item.start + previousSize <= offset &&
            instance.scrollDirection !== 'backward';
    };
    return () => {
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = previous;
    };
  }, [virtualizer]);
  // `useVirtualizer` returns one stable instance. Keep its original method in
  // a ref because the compatibility surface below replaces the public method
  // with a registrar; reading it again on a later render would call our wrapper
  // recursively.
  const tanstackMeasureElement = useRef(virtualizer.measureElement);
  const tanstackScrollToIndex = useRef(virtualizer.scrollToIndex);

  const registeredRow = useCallback((element: HTMLElement) => {
    const index = Number(element.getAttribute('data-index'));
    const { count: currentCount, getItemKey: currentKey } =
      currentOptions.current;
    if (!Number.isInteger(index) || index < 0 || index >= currentCount)
      return null;
    const key = currentKey(index);
    return rowElements.current.get(key) === element ? { key, index } : null;
  }, []);

  const measureElement = useCallback(
    (element: HTMLElement | null) => {
      if (element) {
        const index = Number(element.getAttribute('data-index'));
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index < latestCount.current
        ) {
          rowElements.current.set(latestGetItemKey.current(index), element);
        }
      } else {
        for (const [key, row] of rowElements.current) {
          if (!row.isConnected) rowElements.current.delete(key);
        }
      }
      if (measurementEnabled) {
        tanstackMeasureElement.current.call(
          virtualizer,
          // The compatibility ref is HTMLElement-shaped while the TanStack
          // item generic may be a narrower HTML element.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          element as TItemElement | null,
        );
      }
    },
    [measurementEnabled, tanstackMeasureElement, virtualizer],
  );

  const onFocusCapture = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      const row = registeredRow(event.currentTarget);
      if (row === null) return;
      blurVersion.current++;
      cancelAnimationFrame(blurFrame.current);
      blurFrame.current = 0;
      focusedRow.current = row;
      setFocusedIndexState((previous) =>
        previous === row.index ? previous : row.index,
      );
    },
    [registeredRow],
  );
  const onBlurCapture = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      const row = registeredRow(event.currentTarget);
      if (row === null || focusedRow.current?.key !== row.key) return;
      const version = ++blurVersion.current;
      cancelAnimationFrame(blurFrame.current);
      blurFrame.current = requestAnimationFrame(() => {
        blurFrame.current = 0;
        // A focus transfer into this row's portal emits blur first. Its
        // logical React focus cancels the pending release on the next frame.
        if (
          blurVersion.current === version &&
          focusedRow.current?.key === row.key
        ) {
          focusedRow.current = null;
          setFocusedIndexState(null);
        }
      });
    },
    [registeredRow],
  );

  useEffect(() => {
    const rows = rowElements.current;
    const pendingBlurFrame = blurFrame;
    const pendingBlurVersion = blurVersion;
    return () => {
      pendingBlurVersion.current++;
      cancelAnimationFrame(pendingBlurFrame.current);
      focusedRow.current = null;
      rows.clear();
    };
  }, []);

  const scrollToIndex = useCallback(
    (index: number, scrollOptions?: ScrollToOptions) => {
      if (!hasExplicitCompatibilityMode || compatibilityVirtualized) {
        tanstackScrollToIndex.current.call(virtualizer, index, scrollOptions);
        return;
      }
      if (count === 0) return;
      const targetIndex = Math.max(0, Math.min(index, count - 1));
      rowElements.current.get(getItemKey(targetIndex))?.scrollIntoView({
        block:
          scrollOptions?.align === 'start' || scrollOptions?.align === 'end'
            ? scrollOptions.align
            : 'nearest',
        behavior: scrollOptions?.behavior ?? 'auto',
      });
    },
    [
      compatibilityVirtualized,
      count,
      getItemKey,
      hasExplicitCompatibilityMode,
      virtualizer,
    ],
  );

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const compatibilityItems = useMemo(() => {
    if (!compatibilityVirtualized) {
      let end = 0;
      return Array.from({ length: count }, (_, index) => {
        const start = end;
        const size = options.estimateSize(index);
        end = start + size;
        return {
          key: getItemKey(index),
          index,
          start,
          end,
          size,
          lane: 0,
          paddingBefore: 0,
        };
      });
    }
    let previousEnd = 0;
    return virtualItems.map((item) => {
      const start = item.start - (options.scrollMargin ?? 0);
      const end = item.end - (options.scrollMargin ?? 0);
      const paddingBefore = Math.max(0, start - previousEnd);
      previousEnd = end;
      return {
        key: getItemKey(item.index),
        index: item.index,
        start,
        end,
        size: item.size,
        lane: item.lane,
        paddingBefore,
      };
    });
  }, [compatibilityVirtualized, count, getItemKey, options, virtualItems]);

  const compatibilityTotalSize = compatibilityVirtualized
    ? totalSize
    : compatibilityItems.reduce((end, item) => Math.max(end, item.end), 0);
  const previousEnd = compatibilityItems.at(-1)?.end ?? 0;
  const compatibilityPaddingAfter = compatibilityVirtualized
    ? Math.max(0, totalSize - previousEnd)
    : 0;

  return Object.assign(virtualizer, {
    items: compatibilityItems,
    paddingAfter: compatibilityPaddingAfter,
    totalSize: compatibilityTotalSize,
    virtualized: compatibilityVirtualized,
    measureElement,
    scrollToIndex,
    onFocusCapture,
    onBlurCapture,
  });
}

export {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  type Range,
  type VirtualItem,
  type Virtualizer,
  type VirtualizerOptions,
} from '@tanstack/react-virtual';
