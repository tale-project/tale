import { MAX_CLICKS, MOUSE_BUTTONS } from '@/lib/live-view';

import type { ViewSize } from './fit-view';

/** The part of a DOMRect that maps a mouse position. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PagePoint {
  x: number;
  y: number;
}

/** One decimal is as fine as the page can tell, and keeps the messages short. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A mouse position as the page knows it: in the pixels of its viewport (the
 * space of the last `view` message), not of the picture, which is shown
 * smaller. A position outside the picture stays outside: a drag that leaves
 * it goes on in the page.
 */
export function pagePoint(
  position: { clientX: number; clientY: number },
  rect: Rect,
  view: ViewSize,
): PagePoint {
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: tenth(((position.clientX - rect.left) / rect.width) * view.w),
    y: tenth(((position.clientY - rect.top) / rect.height) * view.h),
  };
}

export type MouseButtonName = (typeof MOUSE_BUTTONS)[number];

/**
 * The button of a mouse event as the stream names it. The side buttons (3,
 * back, and 4, forward) are no buttons of the page: `null`.
 */
export function mouseButtonName(button: number): MouseButtonName | null {
  const known =
    Number.isInteger(button) && button >= 0 && button < MOUSE_BUTTONS.length;
  return known ? MOUSE_BUTTONS[button] : null;
}

/**
 * The click count of a mouse press: the `detail` of the event is how many
 * presses came in a row (0 for an event that no click made), and more than a
 * page can tell apart (`MAX_CLICKS`) is still that many.
 */
export function clickCount(detail: number): number {
  return Math.min(Math.max(Math.trunc(detail) || 1, 1), MAX_CLICKS);
}

/** What a side button of the mouse does in the page's history. */
export function historyAction(button: number): 'back' | 'forward' | null {
  if (button === 3) return 'back';
  if (button === 4) return 'forward';
  return null;
}
