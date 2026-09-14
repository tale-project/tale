'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './date-range-picker.module.css';

/**
 * Marks the portaled calendar so a modal's outside-dismiss can ignore clicks
 * on it. The calendar cannot live inside `overflow: auto` / transformed
 * dialog chrome — that grows the scrollport and clips the last week.
 */
export const DATE_PICKER_POPPER_ATTR = 'data-tale-datepicker-popper';

export function isDatePickerPopperTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${DATE_PICKER_POPPER_ATTR}]`) !== null
  );
}

/**
 * True when the event landed on the portaled calendar — including a click
 * on the month-nav chevron SVG, whose `target` is not the marked root.
 */
export function isDatePickerPopperEvent(event: Event): boolean {
  if (typeof event.composedPath === 'function') {
    for (const node of event.composedPath()) {
      if (
        node instanceof Element &&
        node.closest(`[${DATE_PICKER_POPPER_ATTR}]`) !== null
      ) {
        return true;
      }
    }
  }
  return isDatePickerPopperTarget(event.target);
}

/** Renders the react-datepicker floating calendar on `document.body`. */
export function DatePickerPopperContainer({
  children,
}: {
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    // Native bubble, before document listeners. `preventDefault` is wrong
    // here — it cancels the following `click`, so month arrows do nothing.
    const stop = (event: Event) => {
      event.stopPropagation();
    };
    node.addEventListener('mousedown', stop);
    node.addEventListener('pointerdown', stop);
    return () => {
      node.removeEventListener('mousedown', stop);
      node.removeEventListener('pointerdown', stop);
    };
  }, []);

  if (typeof document === 'undefined') return children;
  return createPortal(
    <div
      ref={ref}
      data-tale-datepicker-popper=""
      className={`${styles.wrapper} ${styles.portal}`}
    >
      {children}
    </div>,
    document.body,
  );
}
