'use client';

/**
 * Dormant history rows for a long transcript (#4121).
 *
 * Rendering every message in full made a 300-message thread cost seconds to
 * open: each row parsed its markdown, highlighted its code and built its
 * toolbar, though the thread opens on its last reply and
 * `content-visibility` already skipped the off-screen rows' layout and paint.
 * So the transcript renders its newest rows in full and mounts the older ones
 * DORMANT: the row's `li` holding the message's words and nothing else —
 * findable with find-in-page, read by assistive technology, reachable by
 * scrolling. A dormant row renders in full before it reaches the viewport,
 * and stays so:
 *  - while scrolling, an IntersectionObserver on the log wakes the rows
 *    within {@link WAKE_MARGIN} of it, in a transition, so a batch of rows
 *    renders without holding the main thread;
 *  - when rows mount dormant inside the view (a thread restored to a
 *    position in its history, a thread of very short messages),
 *    {@link RowWaker.sync} wakes them before the first paint.
 * Keyboard focus needs no wiring of its own: a focused control scrolls into
 * view, and the rows around it wake with that scroll.
 */

import {
  createContext,
  startTransition,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/** How far beyond the visible log a dormant row wakes: three log heights
 * above and below, so a row scrolled toward is in full before it shows. */
const WAKE_MARGIN = '300% 0px';

/** Watches a transcript's dormant rows and wakes them as they near view. */
export interface RowWaker {
  /** Register a dormant row; `wake` runs once — `urgent` when the row must
   * render before the next paint. Answers the unregister. */
  watch(element: Element, wake: (urgent: boolean) => void): () => void;
  /**
   * Bind to the current log, then wake, before paint, every row registered
   * since the last call that the log shows or nearly shows (one log height
   * beyond either edge). For the transcript's layout effect, after its
   * scroll is placed: on the commit that mounts the log together with its
   * rows, the rows register before the log's ref is attached.
   */
  sync(): void;
}

/** One waker per transcript; `getRoot` answers the log's scroller. */
export function createRowWaker(getRoot: () => Element | null): RowWaker {
  const wakers = new Map<Element, (urgent: boolean) => void>();
  /** Registered since the last sync — the only rows sync measures. */
  const fresh = new Set<Element>();
  let observer: IntersectionObserver | null = null;

  const unwatch = (element: Element) => {
    wakers.delete(element);
    fresh.delete(element);
    observer?.unobserve(element);
  };
  const wakeOne = (element: Element, urgent: boolean) => {
    const wake = wakers.get(element);
    if (wake === undefined) return;
    unwatch(element);
    wake(urgent);
  };

  return {
    watch(element, wake) {
      wakers.set(element, wake);
      fresh.add(element);
      observer?.observe(element);
      return () => unwatch(element);
    },
    sync() {
      const root = getRoot();
      if (root === null) return;
      if (typeof IntersectionObserver === 'undefined') {
        for (const element of wakers.keys()) wakeOne(element, true);
        return;
      }
      // A remounted log node gets an observer of its own.
      if (observer?.root !== root) {
        observer?.disconnect();
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) wakeOne(entry.target, false);
            }
          },
          { root, rootMargin: WAKE_MARGIN },
        );
        for (const element of wakers.keys()) observer.observe(element);
      }
      if (fresh.size === 0) return;
      // A log with no height (a collapsed panel, a DOM without layout) shows
      // nothing; the observer still wakes its rows once it has one.
      const reach = root.clientHeight;
      if (reach > 0) {
        const view = root.getBoundingClientRect();
        for (const element of fresh) {
          const rect = element.getBoundingClientRect();
          if (
            rect.bottom >= view.top - reach &&
            rect.top <= view.bottom + reach
          ) {
            wakeOne(element, true);
          }
        }
      }
      fresh.clear();
    },
  };
}

/** The transcript's waker; absent on surfaces that render rows without one
 * (every row is then in full). */
export const RowWakerContext = createContext<RowWaker | null>(null);

/**
 * Whether a row renders in full. A row not `deferred` when it mounts is in
 * full from the start; a deferred one mounts dormant, wakes once (see the
 * module doc) and stays awake — at once when the transcript stops deferring
 * it (the thread got shorter). `ref` goes on the row's element while it is
 * dormant.
 */
export function useRowWake(deferred: boolean): {
  awake: boolean;
  /** The row mounted dormant: it wakes inside the live log. */
  mountedDormant: boolean;
  ref: RefObject<HTMLLIElement | null>;
} {
  const waker = useContext(RowWakerContext);
  const [mountedDormant] = useState(() => deferred && waker !== null);
  const [awake, setAwake] = useState(!mountedDormant);
  if (!awake && !deferred) setAwake(true);
  const ref = useRef<HTMLLIElement | null>(null);

  useLayoutEffect(() => {
    if (awake || waker === null) return undefined;
    const element = ref.current;
    if (element === null) return undefined;
    return waker.watch(element, (urgent) => {
      if (urgent) setAwake(true);
      else startTransition(() => setAwake(true));
    });
  }, [awake, waker]);

  return { awake, mountedDormant, ref };
}
