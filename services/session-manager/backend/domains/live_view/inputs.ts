// What the client does to the page (mouse, keyboard, tabs, address bar),
// applied in order by one loop.
//
// The click that makes a page call confirm() does not return until the dialog
// is answered. If that held up the reading of messages, the answer could not
// be read: the page would look frozen for seconds. So the answers to what the
// browser asks (`URGENT_MESSAGES`) never come here. Moves and scrolls that wait
// behind a slow call are merged (the pointer only needs to get to the last
// place, the page to scroll by the sum), so a long wait does not build up a
// long queue, and a fast wheel does not make the page scroll on for seconds
// after it stopped.

import type { ClientMessage } from '../../../lib/live-view.ts';

/**
 * The one message that does what these two do after each other, if they are
 * moves of the mouse or wheel ticks of one place; else null.
 */
export function mergeInputs(
  earlier: ClientMessage,
  later: ClientMessage,
): ClientMessage | null {
  if (earlier.t === 'mouse' && later.t === 'mouse') {
    return earlier.a === 'move' && later.a === 'move' ? later : null;
  }
  if (earlier.t === 'wheel' && later.t === 'wheel') {
    if (earlier.x !== later.x || earlier.y !== later.y) return null;
    const dx = earlier.dx + later.dx;
    const dy = earlier.dy + later.dy;
    // A sum past the largest double is not a scroll the browser can take: the
    // ticks stay apart.
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    return { ...later, dx, dy };
  }
  return null;
}

/** A queue with one consumer: `get` waits for the next message. */
export class Inputs {
  readonly #queue: ClientMessage[] = [];
  #closed = false;
  #wake: (() => void) | null = null;

  put(message: ClientMessage): void {
    if (this.#closed) return;
    const last = this.#queue.at(-1);
    const merged = last === undefined ? null : mergeInputs(last, message);
    if (merged === null) this.#queue.push(message);
    else this.#queue[this.#queue.length - 1] = merged;
    this.#notify();
  }

  /** What is queued is dropped, `get` returns null from now on. */
  close(): void {
    this.#closed = true;
    this.#queue.length = 0;
    this.#notify();
  }

  async get(): Promise<ClientMessage | null> {
    for (;;) {
      if (this.#closed) return null;
      const message = this.#queue.shift();
      if (message !== undefined) return message;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }
}
