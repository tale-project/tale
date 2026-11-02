import type { CDPSession, Page } from '@playwright/test';

import type { Point } from './viewer-stage';

/** The finger's number in the touch events: there is only ever one. */
const FINGER_ID = 1;

/**
 * How long a finger rests on the picture before it is a long press, the right
 * button of the mouse (the page's own delay, `LONG_PRESS_MS` of
 * `use-remote-pointer.ts`), in milliseconds.
 */
export const LONG_PRESS_MS = 500;

/**
 * How long the page lets go of the mouse events that follow a drag (its
 * `MOUSE_AFTER_DRAG_MS` of `use-remote-pointer.ts`), in milliseconds: a tap
 * sooner than that after a finger dragged is taken for one of them.
 */
export const MOUSE_AFTER_DRAG_MS = 700;

/**
 * How far a finger may wobble and still rest or tap (the page's `TAP_SLOP`),
 * in CSS pixels; one that moves further is dragging the page.
 */
export const TAP_SLOP = 10;

/**
 * One finger on the screen, made of the browser's own touch events
 * (`Input.dispatchTouchEvent`). Playwright's touchscreen can only tap, and a
 * drag or a rest needs a finger that stays down: what the page sees is what a
 * phone sends it, pointer events of the type `touch`, and the mouse events the
 * browser makes of a tap. The page must be in a touch context (`hasTouch`).
 */
export class Finger {
  private constructor(private readonly session: CDPSession) {}

  static async of(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }

  async #send(
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    at?: Point,
  ): Promise<void> {
    await this.session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: at === undefined ? [] : [{ ...at, id: FINGER_ID }],
    });
  }

  /** The finger comes down on the screen at `at`. */
  async press(at: Point): Promise<void> {
    await this.#send('touchStart', at);
  }

  /** The finger, still down, is at `at` now. */
  async moveTo(at: Point): Promise<void> {
    await this.#send('touchMove', at);
  }

  /** The finger, still down, goes from where it is to `to` in `steps` moves. */
  async dragTo(from: Point, to: Point, steps: number): Promise<void> {
    for (let step = 1; step <= steps; step += 1) {
      await this.moveTo({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      });
    }
  }

  /** The finger leaves the screen. */
  async lift(): Promise<void> {
    await this.#send('touchEnd');
  }
}

/**
 * Lets `ms` pass on the page's own clock. What a gesture means depends on its
 * timers (a finger that rests longer than the long-press delay is a right
 * click), and the page's timers run in the order they expire: a wait made in
 * the page after the finger came down ends after the page has decided what the
 * finger meant. It is not a guess at a duration, and no assertion waits on it
 * for something to appear.
 */
export async function letTimePass(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (duration) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, duration);
      }),
    ms,
  );
}
