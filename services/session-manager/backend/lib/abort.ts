// Cancellation for async code. A promise cannot be cancelled, so the work that
// may be stopped takes an `AbortSignal`, waits through `abortable` and looks at
// the signal after every await that precedes a side effect.

/**
 * The work was cancelled (a session was stopped before its browser launched,
 * the app is shutting down). It is not a failure: nothing reports it as one.
 */
export class CancelledError extends Error {
  constructor(message = 'cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelled(error: unknown): error is CancelledError {
  return error instanceof CancelledError;
}

/** The signal for a cancellation: aborting with it makes `throwIfAborted` throw a `CancelledError`. */
export function cancel(controller: AbortController, message?: string): void {
  controller.abort(new CancelledError(message));
}

/**
 * `promise`, or a rejection with the signal's reason as soon as the signal
 * aborts. The promise itself cannot be stopped: it is left to itself then, and
 * whatever it fails with later is of no interest.
 */
export function abortable<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    // Handled on both sides, so that a failure after the abort is not "unhandled".
    void Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Waits `ms` milliseconds. Resolves early, and does not reject, when the signal
 * aborts: the caller looks at the signal itself.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** A latch (the port of `asyncio.Event`): `wait()` returns once `set()` was called, and at once afterwards. */
export class Latch {
  #isSet = false;
  #waiting: (() => void)[] = [];

  get isSet(): boolean {
    return this.#isSet;
  }

  set(): void {
    this.#isSet = true;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const wake of waiting) wake();
  }

  wait(): Promise<void> {
    if (this.#isSet) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }
}
