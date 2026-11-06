'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Fit a textarea's height to its text: a line more for each line typed, a
 * line less for each line removed, between the `min-height` and `max-height`
 * its classes set. Past the max, the text scrolls inside.
 *
 * The field is measured collapsed, and its parent holds its height in the
 * meantime, so no layout around the field depends on the dip. A transcript
 * scrolled to its end above a composer reads a clamped scroll position while
 * the field is short: Chromium drops that clamp once the field grows back
 * in the same task, and the hold keeps it from arising in any engine.
 */
export function fitTextareaToContent(field: HTMLTextAreaElement): void {
  const holder = field.parentElement;
  const heldMinHeight = holder?.style.minHeight ?? '';
  if (holder !== null) {
    holder.style.minHeight = `${holder.getBoundingClientRect().height}px`;
  }
  const { scrollTop } = field;
  const overflowY = field.style.overflowY;
  // Measured without a scrollbar: one would narrow the text and count a
  // wrapped line too many.
  field.style.overflowY = 'hidden';
  field.style.height = 'auto';
  const borders = field.offsetHeight - field.clientHeight;
  field.style.height = `${field.scrollHeight + borders}px`;
  field.style.overflowY = overflowY;
  field.scrollTop = scrollTop;
  if (holder !== null) holder.style.minHeight = heldMinHeight;
}

/**
 * Keep the textarea in `ref` fitted to its text (`fitTextareaToContent`):
 * whenever `value` changes, when the field's width changes (a narrower
 * column wraps more lines), and once the page's fonts have loaded.
 *
 * Give the textarea `rows={1}` so its collapsed height never exceeds its
 * `min-height`, and a `max-height` if it should stop growing.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useLayoutEffect(() => {
    if (ref.current !== null) fitTextareaToContent(ref.current);
  }, [ref, value]);

  useEffect(() => {
    const field = ref.current;
    if (field === null) return undefined;
    let live = true;
    let frame: number | null = null;
    let width = field.offsetWidth;
    const refit = () => {
      frame = null;
      if (live) fitTextareaToContent(field);
    };
    // Refitted a frame later: resizing the field inside the observer's own
    // callback would be reported as a resize loop.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (field.offsetWidth === width) return;
            width = field.offsetWidth;
            frame ??= requestAnimationFrame(refit);
          });
    observer?.observe(field);
    // A web font that arrives after the first fit can wrap the text anew.
    if ('fonts' in document) {
      document.fonts.ready.then(
        () => {
          if (live) fitTextareaToContent(field);
        },
        (error: unknown) => {
          console.warn('[useAutoGrow] the page fonts did not load', error);
        },
      );
    }
    return () => {
      live = false;
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
