'use client';

import { useVirtualList } from '@tale/ui/use-virtual-list';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/** The modal's normal scrollport. The page's reverse scrollport retains its
 * native newest-end anchoring and does not opt into this list window. */
const TaskLogViewportContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

type RowKey = string | number;
type SetRowActive = (rowKey: RowKey, source: string, active: boolean) => void;
const TaskLogRowActivityContext = createContext<
  ((source: string, active: boolean) => void) | null
>(null);

/** Keep explicit interactions alive when their row leaves the viewport.
 * Focus alone does not cover an unsaved editor after it has blurred, or an
 * actor preview whose interactive content is rendered in a portal. */
export function TaskLogRow({
  rowKey,
  setRowActive,
  children,
}: {
  rowKey: RowKey;
  setRowActive: SetRowActive;
  children: ReactNode;
}) {
  const setActive = useCallback(
    (source: string, active: boolean) => setRowActive(rowKey, source, active),
    [rowKey, setRowActive],
  );
  return (
    <TaskLogRowActivityContext.Provider value={setActive}>
      {children}
    </TaskLogRowActivityContext.Provider>
  );
}

export function useTaskLogRowActivity(active: boolean) {
  const setActive = useContext(TaskLogRowActivityContext);
  const source = useId();
  useEffect(() => {
    if (!setActive || !active) return undefined;
    setActive(source, true);
    return () => setActive(source, false);
  }, [active, setActive, source]);
}

export function TaskLogViewport({
  scrollRef,
  children,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <TaskLogViewportContext.Provider value={scrollRef}>
      {children}
    </TaskLogViewportContext.Provider>
  );
}

/** Comments and activity share the modal's scrollport, below a variable-height
 * brief. Measure the list's offset as that preceding content changes so a
 * long description never pushes the virtual window away from its real rows. */
export function useTaskLogWindow({
  count,
  getItemKey,
  estimateSize,
  gap,
}: {
  count: number;
  getItemKey: (index: number) => string | number;
  estimateSize: (index: number) => number;
  gap: number;
}) {
  const scrollRef = useContext(TaskLogViewportContext);
  const [listElement, setListElement] = useState<HTMLElement | null>(null);
  const tracksListElement = scrollRef !== null && count > 100;
  // Stack can render a ul but types its forwarded ref as a div. A callback
  // accepting their common HTMLElement API supports either host safely. Keep
  // attachment reactive when loading history first renders without a list.
  const attachList = useCallback(
    (element: HTMLElement | null) => {
      if (tracksListElement) setListElement(element);
    },
    [tracksListElement],
  );
  const [scrollMargin, setScrollMargin] = useState(0);
  const [activeRows, setActiveRows] = useState(
    () => new Map<RowKey, Set<string>>(),
  );
  const setRowActive = useCallback<SetRowActive>((key, source, active) => {
    setActiveRows((previous) => {
      const sources = previous.get(key);
      if ((sources?.has(source) ?? false) === active) return previous;
      const nextSources = new Set(sources);
      if (active) nextSources.add(source);
      else nextSources.delete(source);
      const next = new Map(previous);
      if (nextSources.size > 0) next.set(key, nextSources);
      else next.delete(key);
      return next;
    });
  }, []);
  const pinnedIndices = useMemo(() => {
    if (activeRows.size === 0) return [];
    const indices: number[] = [];
    for (let index = 0; index < count; index++) {
      if (activeRows.has(getItemKey(index))) indices.push(index);
    }
    return indices;
  }, [activeRows, count, getItemKey]);
  const getScrollElement = useCallback(() => {
    // On a phone the main column flows inside the drawer's scrollport;
    // desktop gives the main column its own overflow. Use the actual CSS
    // scrollport rather than treating the mobile column as a nested viewport.
    let element: HTMLElement | null = scrollRef?.current ?? null;
    while (element !== null) {
      const { overflowY } = getComputedStyle(element);
      if (overflowY === 'auto' || overflowY === 'scroll') return element;
      element = element.parentElement;
    }
    return null;
  }, [scrollRef]);

  const window = useVirtualList({
    count,
    getScrollElement,
    getItemKey,
    estimateSize,
    threshold: scrollRef === null ? Number.POSITIVE_INFINITY : 100,
    gap,
    scrollMargin,
    pinnedIndices,
  });
  useEffect(() => {
    const scrollport = window.scrollElement;
    const list = listElement;
    if (scrollport === null || list === null) return undefined;
    const measureOffset = () => {
      const currentScrollport = getScrollElement();
      if (currentScrollport === null) return;
      const offset =
        list.getBoundingClientRect().top -
        currentScrollport.getBoundingClientRect().top -
        currentScrollport.clientTop +
        currentScrollport.scrollTop;
      setScrollMargin((previous) => (previous === offset ? previous : offset));
    };
    measureOffset();
    const observer = new ResizeObserver(measureOffset);
    observer.observe(scrollport);
    // A description, attachment or comment above this list can move it without
    // changing the list's own dimensions.
    for (const child of scrollport.children) observer.observe(child);
    observer.observe(list);
    return () => observer.disconnect();
  }, [getScrollElement, window.scrollElement, listElement]);

  // Register activity in every mode. A row can become active while the list is
  // below the window threshold and remain active when new rows turn
  // virtualization on; keeping the registration avoids dropping its draft on
  // that crossing render.
  return Object.assign(window, {
    listRef: attachList,
    setRowActive,
  });
}
