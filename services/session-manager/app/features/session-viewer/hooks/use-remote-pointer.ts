import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import type { ViewInfo } from '../lib/live-state';
import {
  clickCount,
  historyAction,
  mouseButtonName,
  pagePoint,
} from '../lib/pointer';
import { WheelAccumulator, wheelPixels } from '../lib/wheel';
import type { ClientMessageInput } from './use-live-view';

/**
 * How far a finger may move and still be a tap (CSS pixels). A tap is a click,
 * which the browser makes of it; a finger that moves further drags the page.
 */
const TAP_SLOP = 10;

/**
 * How long a finger rests on the picture before it is a long press (milliseconds):
 * the right button of the mouse, which is what a long press is everywhere.
 */
export const LONG_PRESS_MS = 500;

/**
 * How long the mouse events that follow a drag are let go (milliseconds): some
 * browsers send them after a finger that did not move much. A press of a mouse
 * ends it sooner.
 */
const MOUSE_AFTER_DRAG_MS = 700;

interface RemotePointerOptions {
  /** The element the picture is shown in: the mouse is read from it. */
  targetRef: RefObject<HTMLElement | null>;
  /** The size of the page that mouse positions are in; no events before it is known. */
  view: ViewInfo | null;
  send: (message: ClientMessageInput) => boolean;
  /** A press on the picture gives the page the keyboard. */
  focusPage: () => void;
  /**
   * The connection works. A button pressed on one that has ended is forgotten
   * (the server let go of it), and a finger does nothing while there is none.
   */
  usable: boolean;
}

/** The finger that is on the picture. */
interface Finger {
  id: number;
  startX: number;
  startY: number;
  /** Where it was when the page last heard of it. */
  lastX: number;
  lastY: number;
  /** It moved further than a tap does. */
  dragging: boolean;
  /** It rested long enough: the right button was clicked for it. */
  held: boolean;
  /** The wait that makes a long press of it. */
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Sends the mouse over the picture of the session's browser to the page it shows:
 * moves (at most one per frame), presses and releases with the button and the
 * click count, the wheel (added up per frame), the side buttons as history.
 * Positions are the page's, not the picture's.
 *
 * A finger is a click when it taps, which the browser makes of it, and a drag
 * when it moves: the page scrolls by the distance, so that its content follows
 * the finger, in the pixels of the page (the picture may be smaller). One that
 * rests on the picture clicks the right button, where it rests.
 *
 * These are native listeners: a wheel listener must not be passive to keep the
 * picture from scrolling the manager, and a press goes on to be released
 * anywhere on the window, not only on the picture.
 */
export function useRemotePointer({
  targetRef,
  view,
  send,
  focusPage,
  usable,
}: RemotePointerOptions): void {
  // The listeners are attached once and read what is current.
  const latest = useRef({ view, send, focusPage, usable });
  useLayoutEffect(() => {
    latest.current = { view, send, focusPage, usable };
  });
  // What each button that is down does to forget it: take its listeners off the window.
  const presses = useRef(new Set<() => void>());

  useEffect(() => {
    const target = targetRef.current;
    if (target === null) return undefined;

    const where = (position: { clientX: number; clientY: number }) => {
      const { view: current } = latest.current;
      if (current === null) return null;
      return pagePoint(position, target.getBoundingClientRect(), current);
    };

    // Moves: the newest position is all the page needs, once per frame.
    let moveFrame = 0;
    let newest = { clientX: 0, clientY: 0 };
    // Set after a drag of a finger: the mouse events that may follow are not a click.
    let afterDrag = false;
    let afterDragTimer: ReturnType<typeof setTimeout> | undefined;
    const queueMove = (event: MouseEvent) => {
      if (afterDrag) return;
      newest = { clientX: event.clientX, clientY: event.clientY };
      if (moveFrame !== 0) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        const point = where(newest);
        if (point !== null)
          latest.current.send({ t: 'mouse', a: 'move', ...point });
      });
    };

    // A button can be released anywhere: a drag may leave the picture. Only
    // the release of its own button counts.
    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      if (afterDrag) return;
      latest.current.focusPage();
      const button = mouseButtonName(event.button);
      // The side buttons are the page's history: they act on release.
      if (button === null) return;
      const point = where(event);
      if (point === null) return;
      const clicks = clickCount(event.detail);
      latest.current.send({ t: 'mouse', a: 'move', ...point });
      latest.current.send({
        t: 'mouse',
        a: 'down',
        ...point,
        b: button,
        n: clicks,
      });
      const release = (up: MouseEvent) => {
        if (up.button !== event.button) return;
        forget();
        latest.current.send({
          t: 'mouse',
          a: 'up',
          ...(where(up) ?? point),
          b: button,
          n: clicks,
        });
      };
      const forget = () => {
        window.removeEventListener('mouseup', release, true);
        window.removeEventListener('mousemove', queueMove, true);
        presses.current.delete(forget);
      };
      presses.current.add(forget);
      window.addEventListener('mouseup', release, true);
      window.addEventListener('mousemove', queueMove, true);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (afterDrag) return;
      const action = historyAction(event.button);
      if (action === null) return;
      event.preventDefault();
      latest.current.send({ t: 'go', a: action });
    };

    // The wheel: what comes in a frame is added up, at the last place it was.
    const wheel = new WheelAccumulator();
    let wheelFrame = 0;
    const queueWheel = () => {
      if (wheelFrame !== 0) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        const total = wheel.take();
        if (total !== null) latest.current.send({ t: 'wheel', ...total });
      });
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { view: current } = latest.current;
      const point = where(event);
      if (current === null || point === null) return;
      const { dx, dy } = wheelPixels(event, current.h);
      wheel.add(point.x, point.y, dx, dy);
      queueWheel();
    };

    // A finger: it only taps (the browser makes a click of that, handled
    // above) until it moves further than a tap does; then it drags the page.
    let finger: Finger | null = null;
    const hold = (resting: Finger) => {
      const { view: current, usable: live, send: tell } = latest.current;
      if (finger !== resting || resting.dragging || !live || current === null) {
        return;
      }
      resting.held = true;
      const point = pagePoint(
        { clientX: resting.startX, clientY: resting.startY },
        target.getBoundingClientRect(),
        current,
      );
      tell({ t: 'mouse', a: 'move', ...point });
      tell({ t: 'mouse', a: 'down', ...point, b: 'right', n: 1 });
      tell({ t: 'mouse', a: 'up', ...point, b: 'right', n: 1 });
    };
    const onPointerDown = (event: PointerEvent) => {
      // Something new is pressed: what a drag left to be let go is over.
      afterDrag = false;
      clearTimeout(afterDragTimer);
      if (event.pointerType !== 'touch' || finger !== null) return;
      const resting: Finger = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragging: false,
        held: false,
        timer: undefined,
      };
      resting.timer = setTimeout(() => hold(resting), LONG_PRESS_MS);
      finger = resting;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (finger === null || event.pointerId !== finger.id) return;
      const { view: current, usable: live } = latest.current;
      if (!live || current === null) return;
      if (!finger.dragging) {
        const moved = Math.hypot(
          event.clientX - finger.startX,
          event.clientY - finger.startY,
        );
        if (moved <= TAP_SLOP) return;
        finger.dragging = true;
        clearTimeout(finger.timer);
      }
      const rect = target.getBoundingClientRect();
      if (!rect.width) return;
      // The picture may be smaller than the page: a finger moves it that much less.
      const scale = rect.width / current.w;
      const dx = (finger.lastX - event.clientX) / scale;
      const dy = (finger.lastY - event.clientY) / scale;
      finger.lastX = event.clientX;
      finger.lastY = event.clientY;
      const point = pagePoint(event, rect, current);
      wheel.add(point.x, point.y, dx, dy);
      queueWheel();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (finger === null || event.pointerId !== finger.id) return;
      clearTimeout(finger.timer);
      if (finger.dragging || finger.held) {
        afterDrag = true;
        afterDragTimer = setTimeout(() => {
          afterDrag = false;
        }, MOUSE_AFTER_DRAG_MS);
      }
      finger = null;
    };

    // The page has its own context menu and drops; the manager must not show its own.
    const prevent = (event: Event) => event.preventDefault();
    const dragEvents = ['dragover', 'drop', 'dragstart'] as const;
    const pointerEnds = ['pointerup', 'pointercancel'] as const;

    target.addEventListener('mousedown', onMouseDown);
    target.addEventListener('mouseup', onMouseUp);
    target.addEventListener('mousemove', queueMove);
    target.addEventListener('contextmenu', prevent);
    target.addEventListener('wheel', onWheel, { passive: false });
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    for (const type of pointerEnds) target.addEventListener(type, onPointerEnd);
    for (const type of dragEvents) target.addEventListener(type, prevent);

    const pressed = presses.current;
    return () => {
      target.removeEventListener('mousedown', onMouseDown);
      target.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('mousemove', queueMove);
      target.removeEventListener('contextmenu', prevent);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      for (const type of pointerEnds) {
        target.removeEventListener(type, onPointerEnd);
      }
      for (const type of dragEvents) target.removeEventListener(type, prevent);
      for (const forget of pressed) forget();
      window.removeEventListener('mousemove', queueMove, true);
      clearTimeout(afterDragTimer);
      clearTimeout(finger?.timer);
      cancelAnimationFrame(moveFrame);
      cancelAnimationFrame(wheelFrame);
    };
  }, [targetRef]);

  // The connection ended with a button down: the server let go of it, and a
  // release that comes later is for a connection that never heard of the press.
  useEffect(() => {
    if (usable) return;
    for (const forget of presses.current) forget();
  }, [usable]);
}
