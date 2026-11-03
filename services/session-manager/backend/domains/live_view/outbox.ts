// What goes to the web client: the messages in order, and only the newest
// picture (a slow client skips frames). What a client that reads nothing has
// been sent is kept to a few megabytes: the newest `tabs` message replaces
// the older ones, and past the allowance the queue is let go of.

import { Buffer } from 'node:buffer';

import type { ServerMessage } from '../../../lib/live-view.ts';
import type { Frame } from '../browser/remote.ts';

/** What the sender writes to the socket: a JSON message, or a picture (JPEG bytes). */
export type Outgoing = ServerMessage | Uint8Array;

/**
 * How many bytes of messages may wait for a client that has not read them. A
 * viewer that reads takes what is sent at once; the largest thing it is sent
 * is the selection of the page, a few megabytes at the most.
 */
export const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export interface OutboxOptions {
  /** Default `MAX_QUEUED_BYTES`. */
  maxQueuedBytes?: number;
}

interface Queued {
  message: ServerMessage;
  /** What it takes on the wire. */
  bytes: number;
}

interface View {
  tab: number;
  width: number;
  height: number;
}

function sameView(a: View | null, b: View): boolean {
  return (
    a !== null &&
    a.tab === b.tab &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * One consumer takes from it with `next`. A picture replaces the one that
 * nobody took yet; the first picture of a new tab or viewport size is
 * preceded by a `view` message, and the two are never torn apart by another
 * message (the client reads mouse coordinates in the space of the last `view`).
 */
export class Outbox {
  readonly #messages: Queued[] = [];
  readonly #limit: number;
  /** The bytes of `#messages`. */
  #queuedBytes = 0;
  /** Too much waited: the queue was dropped and nothing more is taken. */
  #overflowed = false;
  #frame: Frame | null = null;
  /** The picture that follows the `view` message handed out last. */
  #afterView: Uint8Array | null = null;
  #view: View | null = null;
  #finished = false;
  #wake: (() => void) | null = null;

  constructor(options: OutboxOptions = {}) {
    this.#limit = options.maxQueuedBytes ?? MAX_QUEUED_BYTES;
  }

  /**
   * Queues a message. A `tabs` message replaces the one that waits (a list of
   * tabs says everything the older ones said). False when more than the
   * allowance would wait for the client then: the queue is dropped, nothing
   * more will be sent, and the caller ends the connection. A message is always
   * taken when none waits, however large it is.
   */
  send(message: ServerMessage): boolean {
    if (this.#overflowed) return false;
    const bytes = Buffer.byteLength(JSON.stringify(message));
    if (message.t === 'tabs') this.#dropQueuedTabs();
    if (this.#messages.length > 0 && this.#queuedBytes + bytes > this.#limit) {
      this.#overflowed = true;
      this.#messages.length = 0;
      this.#queuedBytes = 0;
      this.#frame = null;
      this.#afterView = null;
      this.finish();
      return false;
    }
    this.#messages.push({ message, bytes });
    this.#queuedBytes += bytes;
    this.#notify();
    return true;
  }

  #dropQueuedTabs(): void {
    for (let i = this.#messages.length - 1; i >= 0; i -= 1) {
      const queued = this.#messages[i];
      if (queued?.message.t !== 'tabs') continue;
      this.#queuedBytes -= queued.bytes;
      this.#messages.splice(i, 1);
    }
  }

  picture(frame: Frame): void {
    if (this.#overflowed) return;
    this.#frame = frame;
    this.#notify();
  }

  /** Nothing more will be sent: `next` returns null once what is queued has gone out. */
  finish(): void {
    this.#finished = true;
    this.#notify();
  }

  async next(): Promise<Outgoing | null> {
    for (;;) {
      const item = this.#take();
      if (item !== undefined) return item;
      if (this.#finished) return null;
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

  #take(): Outgoing | undefined {
    if (this.#afterView !== null) {
      const jpeg = this.#afterView;
      this.#afterView = null;
      return jpeg;
    }
    const queued = this.#messages.shift();
    if (queued !== undefined) {
      this.#queuedBytes -= queued.bytes;
      return queued.message;
    }
    const frame = this.#frame;
    if (frame === null) return undefined;
    this.#frame = null;
    const view: View = {
      tab: frame.tab,
      width: frame.width,
      height: frame.height,
    };
    if (sameView(this.#view, view)) return frame.jpeg;
    this.#view = view;
    this.#afterView = frame.jpeg;
    return { t: 'view', tab: view.tab, w: view.width, h: view.height };
  }
}
