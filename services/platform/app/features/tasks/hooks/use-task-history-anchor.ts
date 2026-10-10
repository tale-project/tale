'use client';

import { findScrollableAncestor } from '@tale/ui/scroll-wheel-chain';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface HistoryAnchor {
  entry: HTMLElement;
  scroller: HTMLElement;
  top: number;
  oldestId: string | undefined;
  frame?: number;
  timeout?: number;
  release: () => void;
}

const READER_TAKEOVER_EVENTS = [
  'wheel',
  'touchstart',
  'pointerdown',
  'keydown',
] as const;
const MAX_SETTLE_MS = 500;

/** Preserve the history entry being read when an older page is inserted.
 * Rectangle deltas work in both the page's reverse scrollport and the
 * dialog's ordinary scrollport. A reader's own scroll cancels the capture. */
export function useTaskHistoryAnchor(
  oldestId: string | undefined,
  loadEarlier: () => void,
  isLoadingEarlier: boolean,
) {
  const historyRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HistoryAnchor | null>(null);

  const loadEarlierWithAnchor = useCallback(() => {
    anchorRef.current?.release();
    const history = historyRef.current;
    const scroller = history && findScrollableAncestor(history.parentElement);
    if (history && scroller) {
      const viewport = scroller.getBoundingClientRect();
      for (const entry of history.querySelectorAll<HTMLElement>(
        '[data-task-history-entry]',
      )) {
        const bounds = entry.getBoundingClientRect();
        if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
          continue;
        }
        const overflowAnchor = scroller.style.overflowAnchor;
        let released = false;
        const anchor: HistoryAnchor = {
          entry,
          scroller,
          top: bounds.top,
          oldestId,
          release: () => {
            if (released) return;
            released = true;
            scroller.removeEventListener('scroll', anchor.release);
            for (const event of READER_TAKEOVER_EVENTS) {
              scroller.removeEventListener(event, anchor.release);
            }
            if (anchor.frame !== undefined) cancelAnimationFrame(anchor.frame);
            if (anchor.timeout !== undefined) clearTimeout(anchor.timeout);
            scroller.style.overflowAnchor = overflowAnchor;
            if (anchorRef.current === anchor) anchorRef.current = null;
          },
        };
        scroller.style.overflowAnchor = 'none';
        scroller.addEventListener('scroll', anchor.release, { once: true });
        for (const event of READER_TAKEOVER_EVENTS) {
          scroller.addEventListener(event, anchor.release, { passive: true });
        }
        anchorRef.current = anchor;
        break;
      }
    }
    loadEarlier();
  }, [loadEarlier, oldestId]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return undefined;
    if (anchor.oldestId === oldestId) {
      if (!isLoadingEarlier) anchor.release();
      return undefined;
    }
    anchor.scroller.removeEventListener('scroll', anchor.release);
    anchor.timeout = window.setTimeout(anchor.release, MAX_SETTLE_MS);
    let previousHeight = -1;
    let stableFrames = 0;
    const restore = () => {
      if (!anchor.entry.isConnected || !anchor.scroller.isConnected) {
        anchor.release();
        return;
      }
      const delta = anchor.entry.getBoundingClientRect().top - anchor.top;
      anchor.scroller.scrollTop += delta;
      const height = historyRef.current?.offsetHeight ?? 0;
      stableFrames =
        height === previousHeight && Math.abs(delta) < 0.5
          ? stableFrames + 1
          : 0;
      previousHeight = height;
      if (stableFrames >= 2) anchor.release();
      else anchor.frame = requestAnimationFrame(restore);
    };
    // Wait for two unchanged layouts, bounded to 500ms and interruptible by
    // reader input: nearby intrinsic heights may resolve across several frames.
    restore();
    return anchor.release;
  }, [oldestId, isLoadingEarlier]);

  useEffect(() => () => anchorRef.current?.release(), []);

  return { historyRef, loadEarlierWithAnchor };
}
