'use client';

import { useLayoutEffect, useRef } from 'react';

import {
  HELD_SCROLLPORTS,
  HISTORY_ENTRY_SELECTOR,
} from './use-task-history-anchor';

/** Within this of the end is the end: scroll offsets are fractional under
 *  browser zoom and on dense screens. */
const END_SLACK_PX = 2;
/** A reader who scrolls down to within this of the end rejoins it. */
const REJOIN_PX = 48;
/** A change in the distance to the end smaller than this is rounding. */
const MOVED_PX = 1;

/** Native scroll anchoring off, as a class so it never fights a host's own
 *  inline style (the history load switches it off inline while it holds a
 *  place). */
const NO_ANCHORING_CLASS = '[overflow-anchor:none]';

/** Chromium and Firefox keep a reader's place themselves when rows above it
 *  change height; Safari has no scroll anchoring. */
function anchorsScroll() {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('overflow-anchor', 'auto')
  );
}

/**
 * Keeps a thread's scrollport where its reader is, the way a chat reads.
 *
 * It opens on the newest end and stays there while the thread grows (a comment
 * arriving, the task loading in, an image settling) and while its own box
 * changes (the composer under it growing, the window resizing). A reader who
 * scrolls up is left where they are, and scrolling back down to the end
 * follows the thread again. Where the browser anchors scrolling, it holds a
 * reading reader's place when a row above them changes height — but not a
 * following reader's: when a row leaves the top as another joins the end, the
 * browser moves the offset by the row that left, and that is not a reader
 * scrolling away. So anchoring is switched off on the scrollport while the
 * thread follows its end, which it pins itself, and back on while they read.
 * Where the browser does not anchor scrolling, rows above the reader that
 * change height — an image arriving, a line that wraps differently after a
 * resize — move the scrollport by the difference, so what is being read does
 * not jump. (The conversation's rows skip layout only where the browser
 * anchors, `lazy-layout.ts`, so none of them changes height as it nears the
 * reader.)
 *
 * Attach `scrollerRef` to an ordinary scrollport and `contentRef` to the one
 * element inside it that holds the thread. The scrollport must scroll from its
 * top (`scrollTop` 0 is the top edge). A `column-reverse` one rests at 0 and
 * scrolls into negative offsets; a modal dialog's scroll lock reads that as
 * "nothing above to scroll to" and cancels every upward wheel and touch over
 * it, which left the board's task dialog unscrollable by trackpad.
 */
export function useThreadScroll() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return undefined;

    const anchors = anchorsScroll();
    const holdsPlace = !anchors;
    let following = true;
    // Where the reader stood when we last looked: the offset, and how far the
    // end was.
    let lastTop = 0;
    let lastDistance = 0;
    // The row the reader is at, and where it stood in the thread.
    let place: { entry: HTMLElement; offset: number } | null = null;

    // The browser's own anchoring is for a reader who is reading.
    const follow = (next: boolean) => {
      following = next;
      if (anchors) scroller.classList.toggle(NO_ANCHORING_CLASS, next);
    };
    const distanceToEnd = () =>
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const look = () => {
      lastTop = scroller.scrollTop;
      lastDistance = distanceToEnd();
    };
    const goToEnd = () => {
      scroller.scrollTop = scroller.scrollHeight;
      look();
    };
    // Where a row is in the thread, whatever the scroll offset: a layout change
    // above the row moves it, a scroll does not.
    const offsetOf = (entry: HTMLElement) =>
      entry.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    // Rows are in document order, one below the other. The reader's place is
    // the first row that starts at or below the middle of the scrollport: it
    // has been in view a while, so it is drawn at its real height, while a row
    // that comes into view above it can still change and push everything
    // under it down.
    const rowAtMiddle = () => {
      const entries = content.querySelectorAll<HTMLElement>(
        HISTORY_ENTRY_SELECTOR,
      );
      const port = scroller.getBoundingClientRect();
      const middle = port.top + port.height / 2;
      let low = 0;
      let high = entries.length - 1;
      let first = entries.length;
      while (low <= high) {
        const probe = Math.floor((low + high) / 2);
        const entry = entries[probe];
        if (entry === undefined) break;
        if (entry.getBoundingClientRect().top >= middle) {
          first = probe;
          high = probe - 1;
        } else {
          low = probe + 1;
        }
      }
      const starting = entries[first];
      return starting !== undefined &&
        starting.getBoundingClientRect().top < port.bottom
        ? starting
        : entries[first - 1];
    };
    // First the row the reader was at, by how far layout moved it since: that
    // is what the scrollport follows, unless a history load is holding the
    // place itself. Then the row they are at now.
    const holdPlace = () => {
      if (
        place !== null &&
        place.entry.isConnected &&
        !HELD_SCROLLPORTS.has(scroller)
      ) {
        const drift = offsetOf(place.entry) - place.offset;
        if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
      }
      const entry = rowAtMiddle();
      place = entry === undefined ? null : { entry, offset: offsetOf(entry) };
    };
    // The scroll event is the one witness of where the reader is, whoever
    // moved the thread: a wheel, a trackpad, a key, the scrollbar, a touch.
    // An event for an offset already looked at is not news: our own write, or a
    // shift the resize observer saw first. For the rest, a reader's scroll
    // moves the offset and the distance to the end in opposite directions:
    // up and farther, or down and nearer. A layout change does not: the
    // browser anchoring, or `holdPlace`, moves the offset and the end together
    // and leaves the distance alone, and a browser giving back an offset it had
    // clamped moves it toward the end while the thread has grown, so the
    // distance grows too. Neither leaves the end or rejoins it.
    const onScroll = () => {
      const top = scroller.scrollTop;
      if (top === lastTop) return;
      const distance = distanceToEnd();
      if (distance <= END_SLACK_PX) follow(true);
      else if (top < lastTop && distance > lastDistance + MOVED_PX) {
        follow(false);
      } else if (
        top > lastTop &&
        distance < lastDistance - MOVED_PX &&
        distance <= REJOIN_PX
      ) {
        follow(true);
      }
      if (following) place = null;
      else if (holdsPlace) holdPlace();
      look();
    };
    const onResize = () => {
      if (following) {
        goToEnd();
        return;
      }
      if (holdsPlace) holdPlace();
      look();
    };

    follow(true);
    goToEnd();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onResize);
    observer.observe(content);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.classList.remove(NO_ANCHORING_CLASS);
      observer.disconnect();
    };
  }, []);

  return { scrollerRef, contentRef };
}
