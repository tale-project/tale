import { useResizeObserver } from '@tale/ui/use-resize-observer';
import {
  useCallback,
  useLayoutEffect,
  useState,
  type RefCallback,
} from 'react';

import type { Size } from '../lib/fit-view';

/** What `size` becomes when the element has this width and height: the same object when nothing changed. */
function sized(width: number, height: number) {
  return (current: Size): Size =>
    current.width === width && current.height === height
      ? current
      : { width, height };
}

/**
 * The size of an element's content box, kept current as the element is
 * resized. Put `ref` on the element; the size is zero until it is laid out.
 *
 * It is measured in a layout effect, before the first paint, so that what is
 * laid out from it (the picture of a session) does not jump: the library's
 * observer (`useResizeObserver`) first reports in an effect, after the paint,
 * and keeps the size current from there.
 */
export function useElementSize<T extends HTMLElement>(): {
  ref: RefCallback<T>;
  size: Size;
} {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize(sized(width, height));
    };
    measure();
  }, [element]);

  const follow = useCallback(() => {
    if (element === null) return;
    const { clientWidth: width, clientHeight: height } = element;
    setSize(sized(width, height));
  }, [element]);
  useResizeObserver(element, follow);

  return { ref: setElement, size };
}
