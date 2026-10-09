/**
 * One chat turn as the tab watching it sees it: the send's POST is held
 * open for the whole turn while the thread's stream reports `progress`
 * (the first one with text is the time to first token) and finally
 * `settled`. A watch is fed the thread stream's events and resolves once
 * the turn settled, or gives up at its deadline.
 */

import type { ThreadEvent } from '../api/realtime.ts';

export interface TurnTimeline {
  /** `performance.now()` when the send was issued. */
  startedAt: number;
  /** First `progress` carrying text. */
  firstTextAt: number | null;
  /** The assistant message the progress named. */
  messageId: string | null;
  /** `settled` arrived (or an `idle` over a streaming lane). */
  settledAt: number | null;
  settledStatus: string | undefined;
  settledFailed: boolean;
  /** The reply as last streamed. */
  lastText: string;
  progressEvents: number;
}

export class TurnWatch {
  readonly timeline: TurnTimeline;
  readonly #now: () => number;
  #onSettled: (() => void) | null = null;
  #onFirstText: (() => void) | null = null;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.timeline = {
      startedAt: now(),
      firstTextAt: null,
      messageId: null,
      settledAt: null,
      settledStatus: undefined,
      settledFailed: false,
      lastText: '',
      progressEvents: 0,
    };
  }

  /** Feed one thread-stream event. */
  onEvent(event: ThreadEvent): void {
    const t = this.timeline;
    if (t.settledAt !== null) return;
    if (event.kind === 'progress') {
      t.progressEvents += 1;
      if (event.messageId !== undefined) t.messageId = event.messageId;
      if (event.text !== '') {
        t.lastText = event.text;
        if (t.firstTextAt === null) {
          t.firstTextAt = this.#now();
          this.#onFirstText?.();
        }
      }
      return;
    }
    if (event.kind === 'settled') {
      if (event.messageId !== undefined) t.messageId = event.messageId;
      t.settledStatus = event.status;
      t.settledFailed = event.failed;
      this.#settle();
      return;
    }
    // A lane that reconnected after missing `settled` reports `idle`: the
    // turn is over even though the frame announcing it was lost.
    if (event.kind === 'idle' && t.progressEvents > 0) this.#settle();
  }

  /** Resolves `true` once settled, `false` at the deadline or on abort. */
  settled(timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    return this.#waitFor(
      () => this.timeline.settledAt !== null,
      (resolve) => {
        this.#onSettled = resolve;
      },
      timeoutMs,
      signal,
    );
  }

  /** Resolves `true` at the first streamed text, `false` otherwise. */
  firstText(timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    return this.#waitFor(
      () => this.timeline.firstTextAt !== null,
      (resolve) => {
        this.#onFirstText = resolve;
      },
      timeoutMs,
      signal,
    );
  }

  #settle(): void {
    this.timeline.settledAt = this.#now();
    this.#onSettled?.();
  }

  #waitFor(
    done: () => boolean,
    register: (resolve: () => void) => void,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (done()) return Promise.resolve(true);
    if (signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const finish = (value: boolean): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = (): void => finish(false);
      const timer = setTimeout(() => finish(done()), timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      register(() => finish(true));
    });
  }
}
