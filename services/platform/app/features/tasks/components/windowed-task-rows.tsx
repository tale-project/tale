import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from '@tanstack/react-virtual';
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import type { TaskRow } from './task-card';

/**
 * A board lane or list section holding more tasks than this mounts only the
 * ones in and near its scrollport ({@link WindowedTaskRows}); a shorter one
 * mounts every task, so a board of ordinary size keeps all of its tasks in
 * the page (find in page, a screen reader's browse mode). Mounting every
 * task made a 2,000-task board block the tab for 16–26 s on each open,
 * search and clear (#4062).
 */
export const WINDOWED_LANE_MIN_CARDS = 40;

/** Tasks mounted past each edge of the scrollport, so a quick scroll or a
 * Tab to the next task never lands on a slot that is still empty. */
const OVERSCAN = 6;

/**
 * A long lane's tasks, windowed: only the tasks in and near the scrollport
 * are mounted, each placed at its measured offset inside a box as tall as
 * the whole lane. The task being dragged and the task holding focus stay
 * mounted wherever the lane scrolls — dnd-kit measures the dragged node, and
 * a focused task that unmounted would drop the focus to the page. Tabbing on
 * from a task scrolls the next one into view, so the keyboard still reaches
 * every task in order.
 *
 * `scrollMargin` is where this box starts inside a scrollport it shares with
 * other content (a list section below its siblings); a board lane's
 * scrollport holds the box alone.
 */
export function WindowedTaskRows({
  tasks,
  scrollElement,
  scrollMargin = 0,
  estimateSize,
  gap = 0,
  activeId,
  renderTask,
}: {
  tasks: readonly TaskRow[];
  scrollElement: HTMLElement | null;
  scrollMargin?: number;
  /** A task's height before it is measured. */
  estimateSize: number;
  /** The space between two tasks, which tasks placed here no longer get
   * from their container's flex gap. */
  gap?: number;
  activeId: string | null;
  renderTask: (task: TaskRow) => ReactNode;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pinned = useMemo(() => {
    const indexes: number[] = [];
    for (const id of [activeId, focusedId]) {
      if (id === null) continue;
      const index = tasks.findIndex((task) => task._id === id);
      if (index >= 0 && !indexes.includes(index)) indexes.push(index);
    }
    return indexes;
  }, [tasks, activeId, focusedId]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const extra = pinned.filter((index) => !indexes.includes(index));
      return extra.length === 0
        ? indexes
        : [...indexes, ...extra].sort((a, b) => a - b);
    },
    [pinned],
  );
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    getItemKey: (index) => tasks[index]?._id ?? index,
    gap,
    overscan: OVERSCAN,
    scrollMargin,
    rangeExtractor,
  });

  return (
    <div
      className="relative w-full shrink-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const task = tasks[item.index];
        if (task === undefined) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{
              transform: `translateY(${item.start - scrollMargin}px)`,
            }}
            // React hands focus moves inside a task's portaled picker to
            // this task as well, so an open picker pins its task too.
            onFocus={() => setFocusedId(task._id)}
            onBlur={() =>
              setFocusedId((current) => (current === task._id ? null : current))
            }
          >
            {renderTask(task)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Where `element` starts inside `scrollElement`'s content, kept current as
 * the content around it changes size (a section above collapses, mounts more
 * rows or loses some) — the `scrollMargin` of a {@link WindowedTaskRows}
 * that shares its scrollport.
 */
export function useOffsetInScrollport(
  element: HTMLElement | null,
  scrollElement: HTMLElement | null,
): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (element === null || scrollElement === null) return undefined;
    const measure = () => {
      const next =
        element.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;
      setOffset((previous) =>
        Math.abs(previous - next) < 1 ? previous : next,
      );
    };
    measure();
    // A resize is measured on the next frame: reading the layout inside the
    // observer's own delivery can resize what it watches in that same frame,
    // which the browser reports as an error ("ResizeObserver loop").
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    for (const child of scrollElement.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [element, scrollElement]);
  return offset;
}
