'use client';

/**
 * The Home stream's list: every row of an ordinary stream, or, past
 * {@link WINDOWED_STREAM_MIN_ROWS}, only the rows in and near the panel's
 * view. A stream of 600 chats mounted 600 rows — each with its menu, its
 * drag handle, its age and its link — on every load and every search, and
 * held them all through every navigation.
 *
 * The windowed list keeps the stream's reading order and its anatomy: rows
 * stay `li`s of one list, each telling assistive technology its place in the
 * whole stream (`aria-posinset` / `aria-setsize`), and the band headings
 * stay sticky. Some rows stay mounted wherever the list scrolls, because
 * something is measured or held through them: every heading, the open row
 * and its two neighbours (⌥↑/⌥↓ step to them, the gliding highlight rests
 * on it), the first and the last row, a row holding focus (its menu, its
 * rename field) and a chat being dragged. ↑/↓/Home/End move through the
 * whole stream, mounting the row they land on.
 */

import { cn } from '@tale/ui/cn';
import {
  defaultRangeExtractor,
  type Range,
  type Virtualizer,
  useVirtualList,
} from '@tale/ui/use-virtual-list';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useThreadDndState } from '@/app/features/chat/components/thread-dnd';
import { useOffsetInScrollport } from '@/app/features/tasks/components/windowed-task-rows';
import { useT } from '@/lib/i18n/client';

import {
  DRAFT_ROW_KEY,
  homeItemKey,
  type HomeGroup,
  type HomeItem,
} from '../lib/home-items';

/**
 * A stream holding more rows than this mounts only the rows near the view;
 * a shorter one mounts every row, so find in page and a screen reader's
 * browse mode keep reaching all of them.
 */
export const WINDOWED_STREAM_MIN_ROWS = 60;

/** Sizes before a row is measured: a two-line row, a band heading. */
const ROW_ESTIMATE = 48;
const HEADING_ESTIMATE = 28;
/** Clear the sticky date band, including its top spacing, when moving up. */
const HEADING_SCROLL_PADDING = 32;
const DRAFT_ESTIMATE = 56;
/** The rows' `gap-px`, which the window places itself. */
const ROW_GAP = 1;
/** Rows mounted past each edge of the view, so a quick scroll or an arrow
 * key never lands on a row that is not there yet. */
const OVERSCAN = 10;
/** What the window shows before the panel has been measured. */
const INITIAL_RECT = { width: 280, height: 720 };

/**
 * What a windowed stream hands each row it mounts: the measuring ref and
 * index for its `li`, the row's place in the whole stream, and the focus
 * report that keeps it mounted while focus is inside it.
 */
export interface HomeRowPlacement {
  readonly measureRef: (node: HTMLLIElement | null) => void;
  readonly index: number;
  readonly position: number;
  readonly size: number;
  readonly onFocusWithin: (key: string, within: boolean) => void;
}

export type HomeListEntry<T> =
  | { readonly kind: 'draft'; readonly key: string }
  | {
      readonly kind: 'heading';
      readonly key: string;
      readonly heading: ReactNode;
      readonly first: boolean;
    }
  | { readonly kind: 'row'; readonly key: string; readonly item: T };

export function HomeStream({
  groups,
  draft,
  renderRow,
  ariaLabel,
  scrollElement,
  activeKey,
}: {
  groups: readonly HomeGroup[];
  /** The provisional row of a fresh chat, leading the stream. */
  draft: ReactNode;
  renderRow: (item: HomeItem, placement?: HomeRowPlacement) => ReactNode;
  ariaLabel: string;
  /** The panel's scrollport, once mounted. */
  scrollElement: HTMLElement | null;
  /** The open row's key: kept mounted, with its neighbours. */
  activeKey: string | null;
}) {
  const { t } = useT('home');
  const { draggedThreadId } = useThreadDndState();
  const draggedKey =
    draggedThreadId === null
      ? null
      : homeItemKey({ kind: 'chat', id: draggedThreadId });
  const hasDraft = draft !== null;
  const entries = useMemo(() => {
    const list: HomeListEntry<HomeItem>[] = [];
    if (hasDraft) list.push({ kind: 'draft', key: DRAFT_ROW_KEY });
    groups.forEach((group, groupIndex) => {
      list.push({
        kind: 'heading',
        key: `heading:${group.key}`,
        heading: t(`groups.${group.key}`),
        first: groupIndex === 0 && !hasDraft,
      });
      for (const item of group.items) {
        list.push({ kind: 'row', key: homeItemKey(item), item });
      }
    });
    return list;
  }, [groups, hasDraft, t]);

  return (
    <HomeWindowedList
      entries={entries}
      draft={draft}
      renderRow={renderRow}
      ariaLabel={ariaLabel}
      scrollElement={scrollElement}
      activeKey={activeKey}
      draggedKey={draggedKey}
      revealActive
    />
  );
}

/** The one Home list engine, shared by the grouped stream, Inbox and projects.
 * Both modes retain the same keyed rows, so live threshold changes preserve
 * an inline draft, a portaled menu and focus. Native rows are measured too. */
export function HomeWindowedList<T>({
  entries,
  draft = null,
  renderRow,
  ariaLabel,
  scrollElement,
  activeKey,
  draggedKey = null,
  as: List = 'ol',
  rowEstimate = ROW_ESTIMATE,
  rowGap = ROW_GAP,
  measurementsPaused = false,
  revealActive = false,
  className,
}: {
  entries: readonly HomeListEntry<T>[];
  draft?: ReactNode;
  renderRow: (item: T, placement?: HomeRowPlacement) => ReactNode;
  ariaLabel?: string;
  scrollElement: HTMLElement | null;
  activeKey: string | null;
  draggedKey?: string | null;
  as?: 'ol' | 'ul';
  rowEstimate?: number;
  rowGap?: number;
  measurementsPaused?: boolean;
  /** Reveal the open work item once; subsequent live reads leave the reader
   * where they scrolled. Projects keep their existing independent position. */
  revealActive?: boolean;
  className?: string;
}) {
  const [listElement, setListElement] = useState<HTMLElement | null>(null);
  const scrollMargin = useOffsetInScrollport(listElement, scrollElement);

  // The rows (the draft included) in stream order, and where each sits in
  // the list of entries.
  const rowIndexes = useMemo(
    () =>
      entries.flatMap((entry, index) =>
        entry.kind === 'heading' ? [] : [index],
      ),
    [entries],
  );
  const indexByKey = useMemo(
    () => new Map(entries.map((entry, index) => [entry.key, index])),
    [entries],
  );

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(release.current), []);
  const onFocusWithin = useCallback((key: string, within: boolean) => {
    clearTimeout(release.current);
    if (within) {
      setFocusedKey(key);
      return;
    }
    // Portaled menu focus can follow the blur in a later React event. Keep
    // the row until that focus either returns or settles elsewhere.
    release.current = setTimeout(() => {
      setFocusedKey((current) => (current === key ? null : current));
    }, 0);
  }, []);

  const pinned = useMemo(() => {
    const indexes = new Set<number>();
    entries.forEach((entry, index) => {
      if (entry.kind !== 'row') indexes.add(index);
    });
    const first = rowIndexes[0];
    const last = rowIndexes.at(-1);
    if (first !== undefined) indexes.add(first);
    if (last !== undefined) indexes.add(last);
    for (const key of [activeKey, focusedKey]) {
      const at =
        key === null ? -1 : rowIndexes.indexOf(indexByKey.get(key) ?? -1);
      if (at !== -1) {
        for (const neighbour of [at - 1, at, at + 1]) {
          const index = rowIndexes[neighbour];
          if (index !== undefined) indexes.add(index);
        }
      }
    }
    for (const key of [focusedKey, pendingFocusKey, draggedKey]) {
      const index = key === null ? undefined : indexByKey.get(key);
      if (index !== undefined) indexes.add(index);
    }
    return indexes;
  }, [
    entries,
    rowIndexes,
    indexByKey,
    activeKey,
    focusedKey,
    pendingFocusKey,
    draggedKey,
  ]);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      for (const index of pinned) {
        if (index < range.count) indexes.add(index);
      }
      return [...indexes].sort((a, b) => a - b);
    },
    [pinned],
  );

  const windowed = rowIndexes.length > WINDOWED_STREAM_MIN_ROWS;
  const virtualizer = useVirtualList<HTMLElement, HTMLLIElement>({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => {
      const entry = entries[index];
      if (entry?.kind === 'heading') return HEADING_ESTIMATE;
      if (entry?.kind === 'draft') return DRAFT_ESTIMATE;
      return rowEstimate;
    },
    getItemKey: (index) => entries[index]?.key ?? index,
    gap: rowGap,
    overscan: OVERSCAN,
    scrollMargin,
    scrollPaddingStart: entries.some((entry) => entry.kind === 'heading')
      ? HEADING_SCROLL_PADDING
      : 0,
    initialRect: INITIAL_RECT,
    rangeExtractor,
    enabled: entries.length > 0,
    useCachedMeasurements: measurementsPaused,
    useAnimationFrameWithResizeObserver: true,
    measureElement: (element, entry) =>
      entry?.borderBoxSize[0]?.blockSize ??
      element.getBoundingClientRect().height,
  });

  const placements = useStablePlacements(
    entries,
    rowIndexes,
    virtualizer,
    onFocusWithin,
  );

  // A parent effect runs before the stateful scrollport reaches this child.
  // Its native smooth scroll would then be cancelled by the virtualizer's
  // initial offset write. Let the attached virtualizer own the reveal and
  // reconcile its target as estimated row heights become measured heights.
  const revealedKey = useRef<string | null>(null);
  useEffect(() => {
    if (
      !revealActive ||
      activeKey === null ||
      scrollElement === null ||
      virtualizer.scrollElement !== scrollElement ||
      revealedKey.current === activeKey
    )
      return;
    const index = indexByKey.get(activeKey);
    if (index === undefined) return;
    revealedKey.current = activeKey;
    // An already visible item needs no scroll command that might keep
    // chasing it if the reader starts scrolling straight after opening.
    if (
      virtualizer.getOffsetForIndex(index, 'auto')?.[0] ===
      scrollElement.scrollTop
    )
      return;
    virtualizer.scrollToIndex(index, {
      align: 'auto',
      // A long window resolves estimated heights as it travels. Reveal its
      // indexed destination directly; ordinary lists retain their glide.
      behavior: windowed ? 'auto' : 'smooth',
    });
  }, [
    revealActive,
    activeKey,
    scrollElement,
    virtualizer,
    indexByKey,
    windowed,
  ]);

  const focusRow = useCallback(
    (key: string) => {
      const index = indexByKey.get(key);
      if (index === undefined) return;
      // First/last/open rows can be pinned far outside the viewport. Even
      // when their link already exists, the indexed command must reconcile
      // late measurements rather than leave native focus partly clipped.
      virtualizer.scrollToIndex(index, { align: 'auto' });
      const link = listElement?.querySelector<HTMLElement>(
        `[data-indicator-key="${CSS.escape(key)}"]`,
      );
      if (link) {
        link.focus({ preventScroll: true });
        return;
      }
      setPendingFocusKey(key);
    },
    [listElement, indexByKey, virtualizer],
  );

  const virtualItems = virtualizer.getVirtualItems();
  const items = windowed
    ? virtualItems
    : entries.map((entry, index) => ({
        key: entry.key,
        index,
        start: 0,
        end: 0,
      }));

  // A row ↑/↓/Home/End moved to that was not mounted yet takes the focus
  // once the window mounts it.
  useLayoutEffect(() => {
    if (pendingFocusKey === null) return;
    const link = listElement?.querySelector<HTMLElement>(
      `[data-indicator-key="${CSS.escape(pendingFocusKey)}"]`,
    );
    if (!link) return;
    link.focus({ preventScroll: true });
    setPendingFocusKey(null);
  }, [pendingFocusKey, listElement, virtualItems]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.matches('a[data-indicator-key],button[data-indicator-key]')
    ) {
      return;
    }
    const at = rowIndexes.indexOf(
      indexByKey.get(target.dataset.indicatorKey ?? '') ?? -1,
    );
    if (at === -1) return;
    const next =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rowIndexes.length - 1
              : undefined;
    const index = next === undefined ? undefined : rowIndexes[next];
    const entry = index === undefined ? undefined : entries[index];
    if (entry === undefined) return;
    event.preventDefault();
    focusRow(entry.key);
  };

  const totalSize = virtualizer.getTotalSize();
  const nodes: ReactNode[] = [];
  items.forEach((virtualItem, position) => {
    const entry = entries[virtualItem.index];
    if (entry === undefined) return;
    // Rows the window leaves out are stood in for by one spacer, so the
    // mounted rows sit where the whole stream would put them; the list's
    // gap falls on both sides of it.
    const previous = items[position - 1];
    const space = !windowed
      ? 0
      : previous === undefined
        ? virtualItem.index === 0
          ? 0
          : virtualItem.start - scrollMargin - rowGap
        : virtualItem.index === previous.index + 1
          ? 0
          : virtualItem.start - previous.end - 2 * rowGap;
    nodes.push(
      <Fragment key={entry.key}>
        {space > 0 && <Spacer height={space} />}
        {entry.kind === 'heading' ? (
          <li
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className={
              entry.first
                ? 'bg-background sticky top-0 z-20'
                : 'bg-background sticky top-0 z-20 pt-[3px]'
            }
          >
            <h3 className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              {entry.heading}
            </h3>
          </li>
        ) : entry.kind === 'draft' ? (
          <li
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            aria-posinset={placements.get(entry.key)?.position}
            aria-setsize={rowIndexes.length}
            onFocus={() => onFocusWithin(entry.key, true)}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next))
                return;
              onFocusWithin(entry.key, false);
            }}
          >
            <ul role="list" className="flex flex-col pt-2">
              {draft}
            </ul>
          </li>
        ) : (
          renderRow(entry.item, placements.get(entry.key))
        )}
      </Fragment>,
    );
  });
  const last = items.at(-1);
  const trailing =
    !windowed || last === undefined || last.index === entries.length - 1
      ? 0
      : totalSize - (last.end - scrollMargin) - rowGap;

  return (
    <List
      ref={setListElement}
      role={List === 'ul' ? 'list' : undefined}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'animate-in fade-in-0 flex flex-col duration-200 motion-reduce:animate-none',
        className,
      )}
      style={{ gap: rowGap }}
    >
      {nodes}
      {trailing > 0 && <Spacer height={trailing} />}
    </List>
  );
}

function Spacer({ height }: { height: number }) {
  return (
    <li
      aria-hidden="true"
      role="presentation"
      className="shrink-0"
      style={{ height }}
    />
  );
}

/**
 * One placement object per row, kept while its placement is unchanged:
 * scrolling or another row's live update leaves a memoized row alone.
 */
function useStablePlacements<T>(
  entries: readonly HomeListEntry<T>[],
  rowIndexes: readonly number[],
  virtualizer: Virtualizer<HTMLElement, HTMLLIElement>,
  onFocusWithin: (key: string, within: boolean) => void,
): ReadonlyMap<string, HomeRowPlacement> {
  const { measureElement } = virtualizer;
  const previous = useRef<ReadonlyMap<string, HomeRowPlacement>>(new Map());
  const placements = useMemo(() => {
    const map = new Map<string, HomeRowPlacement>();
    rowIndexes.forEach((index, position) => {
      const entry = entries[index];
      if (entry === undefined) return;
      const cached = previous.current.get(entry.key);
      map.set(
        entry.key,
        cached?.measureRef === measureElement &&
          cached.index === index &&
          cached.position === position + 1 &&
          cached.size === rowIndexes.length &&
          cached.onFocusWithin === onFocusWithin
          ? cached
          : {
              measureRef: measureElement,
              index,
              position: position + 1,
              size: rowIndexes.length,
              onFocusWithin,
            },
      );
    });
    return map;
  }, [entries, rowIndexes, measureElement, onFocusWithin]);
  useLayoutEffect(() => {
    previous.current = placements;
  }, [placements]);
  return placements;
}
