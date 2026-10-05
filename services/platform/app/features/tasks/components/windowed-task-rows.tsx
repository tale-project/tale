import {
  defaultRangeExtractor,
  type Range,
  useVirtualList,
} from '@tale/ui/use-virtual-list';
import { observeElementOffset } from '@tanstack/react-virtual';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { TaskRow } from './task-card';

/**
 * A board lane or list section holding more tasks than this mounts only the
 * ones in and near its scrollport ({@link WindowedTaskRows}); a shorter one
 * mounts every task, so a board of ordinary size keeps all of its tasks in
 * the page (find in page, a screen reader's browse mode). Mounting every
 * task made a 2,000-task board block the tab for 16–26 s on each open,
 * search and clear.
 */
export const WINDOWED_LANE_MIN_CARDS = 40;

/**
 * A windowed lane mounts every task again only below this. The gap to
 * {@link WINDOWED_LANE_MIN_CARDS} keeps a lane that hovers around 40 tasks
 * from switching layouts on each move. Both modes retain the same keyed
 * wrappers, so picker state and focus also survive the eventual switch.
 */
export const UNWINDOWED_LANE_MAX_CARDS = 30;

/** Whether a lane of `count` tasks is windowed, with the hysteresis above. */
export function useLaneWindowed(count: number): boolean {
  const [windowed, setWindowed] = useState(count > WINDOWED_LANE_MIN_CARDS);
  const next = windowed
    ? count >= UNWINDOWED_LANE_MAX_CARDS
    : count > WINDOWED_LANE_MIN_CARDS;
  if (next !== windowed) setWindowed(next);
  return next;
}

/** Tasks mounted past each edge of the scrollport, so a quick scroll or a
 * Tab to the next task never lands on a slot that is still empty. */
const OVERSCAN = 6;

/**
 * A long lane mounts only the tasks in and near its scrollport, measured
 * inside a box as tall as the whole lane. Both modes keep the same keyed
 * wrappers so live reads crossing the threshold retain picker state and
 * focus. Focused tasks, their keyboard neighbours and the active drag source
 * remain mounted while scrolling. The full ordered SortableContext stays
 * outside, so drag placement still uses every task.
 *
 * `scrollMargin` is where this box starts inside a scrollport it shares with
 * other content (a list section below its siblings); a board lane's
 * scrollport holds the box alone.
 */
export function WindowedTaskRows({
  tasks,
  windowed,
  scrollElement,
  scrollMargin = 0,
  estimateSize,
  gap = 0,
  activeId,
  renderTask,
}: {
  tasks: readonly TaskRow[];
  /** The containing lane owns this mode, including its hysteresis. */
  windowed: boolean;
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
  // A blur only lets a task go once no focus follows it into the same task:
  // the next control of a task (or its portaled picker) takes the focus
  // right after the blur, and React renders between the two, so letting go
  // at once could unmount the task under the focus that is moving into it.
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(release.current), []);
  const pinned = useMemo(() => {
    const indexes = new Set<number>();
    const focusedIndex = tasks.findIndex((task) => task._id === focusedId);
    if (focusedIndex >= 0) {
      // Native Tab follows the complete order even at a window boundary.
      for (const index of [focusedIndex - 1, focusedIndex, focusedIndex + 1]) {
        if (index >= 0 && index < tasks.length) indexes.add(index);
      }
    }
    const activeIndex = tasks.findIndex((task) => task._id === activeId);
    if (activeIndex >= 0) indexes.add(activeIndex);
    return [...indexes];
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
  const virtualizer = useVirtualList({
    count: tasks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    getItemKey: (index) => tasks[index]?._id ?? index,
    gap,
    overscan: OVERSCAN,
    scrollMargin,
    rangeExtractor,
    // Measure the bounded native rows too: guesses replacing their actual
    // heights at the threshold would move the reader's current task.
    enabled: tasks.length > 0,
    initialRect: { width: 800, height: 600 },
    initialOffset: () => scrollElement?.scrollTop ?? 0,
    // Preserve subpixel card heights instead of accumulating rounded pixels
    // when native layout becomes positioned rows at the threshold.
    measureElement: (element, entry) =>
      entry?.borderBoxSize[0]?.blockSize ??
      element.getBoundingClientRect().height,
    observeElementOffset: (instance, callback) => {
      // TanStack subscribes before writing its remembered offset. Seed that
      // memory from this shared scrollport rather than reset it on attachment.
      callback(instance.scrollElement?.scrollTop ?? 0, false);
      return observeElementOffset(instance, callback);
    },
    useAnimationFrameWithResizeObserver: true,
  });
  const items = windowed
    ? virtualizer.getVirtualItems()
    : tasks.map((task, index) => ({ key: task._id, index, start: 0 }));

  return (
    <div
      className="relative flex w-full shrink-0 flex-col"
      style={windowed ? { height: virtualizer.getTotalSize() } : { gap }}
    >
      {items.map((item) => {
        const task = tasks[item.index];
        if (task === undefined) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            data-task-id={task._id}
            ref={virtualizer.measureElement}
            className={windowed ? 'absolute top-0 left-0 w-full' : 'w-full'}
            style={
              windowed
                ? {
                    transform: `translateY(${item.start - scrollMargin}px)`,
                  }
                : undefined
            }
            // Capture native focus before live updates enable windowing;
            // React also carries focus from a task's picker portal here.
            onFocusCapture={() => {
              clearTimeout(release.current);
              setFocusedId(task._id);
            }}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) {
                return;
              }
              clearTimeout(release.current);
              release.current = setTimeout(() => {
                setFocusedId((current) =>
                  current === task._id ? null : current,
                );
              }, 0);
            }}
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
