import { useResizeObserver } from '@tale/ui/use-resize-observer';
import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * A value that follows the width of an element: `derive(width)`, measured
 * before the first paint, so a narrow column never shows the wide layout for a
 * frame: the library's observer (`useResizeObserver`) first reports in an
 * effect, after the paint, and keeps the answer current from there. Where
 * nothing can be measured (no layout yet, or hidden) it keeps what it had,
 * `initial` at first: a hidden element is not a narrow one. Give it a `derive`
 * that stays the same between renders, as a function of the module does.
 */
export function useWidthValue<T>(
  ref: RefObject<HTMLElement | null>,
  derive: (width: number) => T,
  initial: T,
): T {
  const [value, setValue] = useState(initial);

  const measure = useCallback(() => {
    const width = ref.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) setValue(derive(width));
  }, [ref, derive]);

  useLayoutEffect(measure, [measure]);
  useResizeObserver(ref, measure);

  return value;
}

/**
 * Whether an element is at least `minWidth` px wide. A table asks it of its own
 * column to know whether its columns fit, because it is the column that decides,
 * not the window: beside the rail the page column is 84 px narrower than the
 * window, and a window's media query would be that figure written out by hand.
 * Where nothing can be measured it fits: the full layout is the one a first
 * render and a test without layout get.
 */
export function useFitsWidth(
  ref: RefObject<HTMLElement | null>,
  minWidth: number,
): boolean {
  const fits = useCallback((width: number) => width >= minWidth, [minWidth]);
  return useWidthValue(ref, fits, true);
}
