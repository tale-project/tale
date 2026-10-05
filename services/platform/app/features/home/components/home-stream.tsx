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

import {
  defaultRangeExtractor,
  type Range,
  type VirtualItem,
  type Virtualizer,
  useVirtualizer,
} from '@tanstack/react-virtual';
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
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
  type HomeGroupKey,
  type HomeItem,
} from '../lib/home-items';
import { moveRowFocus } from '../lib/row-navigation';

/**
 * A stream holding more rows than this mounts only the rows near the view;
 * a shorter one mounts every row, so find in page and a screen reader's
 * browse mode keep reaching all of them.
 */
export const WINDOWED_STREAM_MIN_ROWS = 60;

/** Sizes before a row is measured: a two-line row, a band heading. */
const ROW_ESTIMATE = 48;
const HEADING_ESTIMATE = 28;
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

type Entry =
  | { readonly kind: 'draft'; readonly key: string }
  | {
      readonly kind: 'heading';
      readonly key: string;
      readonly group: HomeGroupKey;
      readonly first: boolean;
    }
  | { readonly kind: 'row'; readonly key: string; readonly item: HomeItem };

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
  const rowCount =
    groups.reduce((count, group) => count + group.items.length, 0) +
    (draft === null ? 0 : 1);

  if (rowCount <= WINDOWED_STREAM_MIN_ROWS) {
    return (
      <ol
        aria-label={ariaLabel}
        onKeyDown={moveRowFocus}
        className="animate-in fade-in-0 flex flex-col gap-1 duration-200 motion-reduce:animate-none"
      >
        {draft !== null && (
          <li>
            <ul role="list" className="flex flex-col pt-2">
              {draft}
            </ul>
          </li>
        )}
        {groups.map((group) => (
          <li key={group.key}>
            <h3 className="bg-background text-muted-foreground sticky top-0 z-20 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              {t(`groups.${group.key}`)}
            </h3>
            <ul role="list" className="flex flex-col gap-px">
              {group.items.map((item) => renderRow(item))}
            </ul>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <WindowedHomeStream
      groups={groups}
      draft={draft}
      renderRow={renderRow}
      ariaLabel={ariaLabel}
      scrollElement={scrollElement}
      activeKey={activeKey}
    />
  );
}

function WindowedHomeStream({
  groups,
  draft,
  renderRow,
  ariaLabel,
  scrollElement,
  activeKey,
}: {
  groups: readonly HomeGroup[];
  draft: ReactNode;
  renderRow: (item: HomeItem, placement?: HomeRowPlacement) => ReactNode;
  ariaLabel: string;
  scrollElement: HTMLElement | null;
  activeKey: string | null;
}) {
  const { t } = useT('home');
  // dnd-kit measures the dragged row while it travels: it stays mounted.
  const { draggedThreadId } = useThreadDndState();
  const draggedKey =
    draggedThreadId === null
      ? null
      : homeItemKey({ kind: 'chat', id: draggedThreadId });
  const [listElement, setListElement] = useState<HTMLOListElement | null>(null);
  const scrollMargin = useOffsetInScrollport(listElement, scrollElement);

  const entries = useMemo(() => {
    const list: Entry[] = [];
    if (draft !== null) list.push({ kind: 'draft', key: DRAFT_ROW_KEY });
    groups.forEach((group, groupIndex) => {
      list.push({
        kind: 'heading',
        key: `heading:${group.key}`,
        group: group.key,
        first: groupIndex === 0 && draft === null,
      });
      for (const item of group.items) {
        list.push({ kind: 'row', key: homeItemKey(item), item });
      }
    });
    return list;
  }, [groups, draft]);

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
  const onFocusWithin = useCallback((key: string, within: boolean) => {
    setFocusedKey((current) =>
      within ? key : current === key ? null : current,
    );
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
    const active = activeKey === null ? undefined : indexByKey.get(activeKey);
    if (active !== undefined) {
      const at = rowIndexes.indexOf(active);
      for (const neighbour of [at - 1, at, at + 1]) {
        const index = rowIndexes[neighbour];
        if (index !== undefined) indexes.add(index);
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

  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => {
      const entry = entries[index];
      if (entry?.kind === 'heading') return HEADING_ESTIMATE;
      if (entry?.kind === 'draft') return DRAFT_ESTIMATE;
      return ROW_ESTIMATE;
    },
    getItemKey: (index) => entries[index]?.key ?? index,
    gap: ROW_GAP,
    overscan: OVERSCAN,
    scrollMargin,
    initialRect: INITIAL_RECT,
    rangeExtractor,
  });

  const placements = useStablePlacements(
    entries,
    rowIndexes,
    virtualizer,
    onFocusWithin,
  );

  const rowKeys = useMemo(
    () => rowIndexes.flatMap((index) => entries[index]?.key ?? []),
    [rowIndexes, entries],
  );
  const handleKeyDown = useRowWindowKeys({
    listElement,
    rowKeys,
    indexByKey,
    virtualizer,
    pendingFocusKey,
    setPendingFocusKey,
  });

  const items = virtualizer.getVirtualItems();
  const spacing = windowSpacing(
    items,
    entries.length,
    virtualizer.getTotalSize(),
    scrollMargin,
    ROW_GAP,
  );
  const nodes: ReactNode[] = [];
  items.forEach((virtualItem, position) => {
    const entry = entries[virtualItem.index];
    if (entry === undefined) return;
    const space = spacing.before[position] ?? 0;
    nodes.push(
      <Fragment key={entry.key}>
        {space > 0 && <WindowSpacer height={space} />}
        {entry.kind === 'heading' ? (
          <li
            role="presentation"
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className={
              entry.first
                ? 'bg-background sticky top-0 z-20'
                : 'bg-background sticky top-0 z-20 pt-[3px]'
            }
          >
            <h3 className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              {t(`groups.${entry.group}`)}
            </h3>
          </li>
        ) : entry.kind === 'draft' ? (
          <li data-index={virtualItem.index} ref={virtualizer.measureElement}>
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
  return (
    <ol
      ref={setListElement}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="animate-in fade-in-0 flex flex-col gap-px duration-200 motion-reduce:animate-none"
    >
      {nodes}
      {spacing.after > 0 && <WindowSpacer height={spacing.after} />}
    </ol>
  );
}

/**
 * The room a windowed flow list leaves for the items it did not mount: the
 * height of the spacer before each mounted item (`before`, by its place in
 * `items`) and after the last (`after`). The list lays its children out with
 * `gap` between them, spacers included, so each mounted item sits where the
 * whole list would put it.
 */
export function windowSpacing(
  items: readonly VirtualItem[],
  count: number,
  totalSize: number,
  scrollMargin: number,
  gap: number,
  /** The list's own padding, given to the virtualizer as
   * `paddingStart` / `paddingEnd` too. */
  padding: { start: number; end: number } = { start: 0, end: 0 },
): { before: number[]; after: number } {
  const before = items.map((item, position) => {
    const previous = items[position - 1];
    if (previous === undefined) {
      return item.index === 0
        ? 0
        : item.start - scrollMargin - padding.start - gap;
    }
    return item.index === previous.index + 1
      ? 0
      : item.start - previous.end - 2 * gap;
  });
  const last = items.at(-1);
  const after =
    last === undefined || last.index === count - 1
      ? 0
      : totalSize - (last.end - scrollMargin) - gap - padding.end;
  return { before, after };
}

/** One spacer of a windowed list: hidden from assistive technology, which
 * counts the list's items by `aria-setsize` instead. */
export function WindowSpacer({ height }: { height: number }) {
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
 * ↑/↓/Home/End through every row of a windowed list: `rowKeys` in order,
 * `indexByKey` each row's place among the virtualizer's items. A row's
 * focusable element carries `data-indicator-key`; one the window has not
 * mounted is scrolled to, kept mounted (`pendingFocusKey`, which the list
 * pins) and focused once it is. Answers the list's `onKeyDown`.
 */
export function useRowWindowKeys({
  listElement,
  rowKeys,
  indexByKey,
  virtualizer,
  pendingFocusKey,
  setPendingFocusKey,
}: {
  listElement: HTMLElement | null;
  rowKeys: readonly string[];
  indexByKey: ReadonlyMap<string, number>;
  virtualizer: Virtualizer<HTMLElement, HTMLLIElement>;
  pendingFocusKey: string | null;
  setPendingFocusKey: (key: string | null) => void;
}): (event: KeyboardEvent<HTMLElement>) => void {
  const findRow = useCallback(
    (key: string) =>
      listElement?.querySelector<HTMLElement>(
        `[data-indicator-key="${CSS.escape(key)}"]`,
      ) ?? null,
    [listElement],
  );

  const items = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    if (pendingFocusKey === null) return;
    const row = findRow(pendingFocusKey);
    if (row === null) return;
    row.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey, findRow, items, setPendingFocusKey]);

  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const at = rowKeys.indexOf(target.dataset.indicatorKey ?? '');
    if (at === -1) return;
    const next =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rowKeys.length - 1
              : undefined;
    const key = next === undefined ? undefined : rowKeys[next];
    if (key === undefined) return;
    event.preventDefault();
    const row = findRow(key);
    if (row !== null) {
      row.focus();
      return;
    }
    const index = indexByKey.get(key);
    if (index === undefined) return;
    setPendingFocusKey(key);
    virtualizer.scrollToIndex(index, { align: 'auto' });
  };
}

/**
 * One placement object per row, kept while the stream's entries are: a
 * memoized row then re-renders as the list scrolls only when it mounts.
 */
function useStablePlacements(
  entries: readonly Entry[],
  rowIndexes: readonly number[],
  virtualizer: Virtualizer<HTMLElement, HTMLLIElement>,
  onFocusWithin: (key: string, within: boolean) => void,
): ReadonlyMap<string, HomeRowPlacement> {
  const { measureElement } = virtualizer;
  return useMemo(() => {
    const map = new Map<string, HomeRowPlacement>();
    rowIndexes.forEach((index, position) => {
      const entry = entries[index];
      if (entry === undefined) return;
      map.set(entry.key, {
        measureRef: measureElement,
        index,
        position: position + 1,
        size: rowIndexes.length,
        onFocusWithin,
      });
    });
    return map;
  }, [entries, rowIndexes, measureElement, onFocusWithin]);
}
