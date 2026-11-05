import { AsyncLocalStorage } from 'node:async_hooks';

// A lifecycle operation crosses several resource helpers. Each hop inherits
// one cancellation budget; a sequence of bounded calls is not an unbounded
// operation. Cleanup deliberately runs outside the expired create budget.
const current = new AsyncLocalStorage<
  { signal: AbortSignal; deadline: number } | undefined
>();

/** The reason a budget aborts with when its time is up. A caller's own
 * cancellation keeps its reason. */
export class OperationDeadlineError extends Error {
  constructor() {
    super('sandbox operation deadline exceeded');
    this.name = 'OperationDeadlineError';
  }
}

export function operationSignal(signal: AbortSignal): AbortSignal;
export function operationSignal(signal?: AbortSignal): AbortSignal | undefined;
export function operationSignal(signal?: AbortSignal): AbortSignal | undefined {
  const inherited = current.getStore()?.signal;
  if (inherited === undefined) return signal;
  return signal === undefined
    ? inherited
    : AbortSignal.any([inherited, signal]);
}

/** The whole milliseconds left of the tightest budget the caller runs in;
 * undefined outside one. */
export function operationRemainingMs(): number | undefined {
  const store = current.getStore();
  if (store === undefined) return undefined;
  return Math.max(0, Math.floor(store.deadline - performance.now()));
}

export async function withOperationBudget<T>(
  timeoutMs: number,
  action: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new OperationDeadlineError()),
    timeoutMs,
  );
  timer.unref();
  // A nested budget ends no later than the one it runs in.
  const deadline = Math.min(
    performance.now() + timeoutMs,
    current.getStore()?.deadline ?? Infinity,
  );
  const parent = operationSignal(signal);
  const combined =
    parent === undefined
      ? controller.signal
      : AbortSignal.any([parent, controller.signal]);
  try {
    combined.throwIfAborted();
    return await current.run({ signal: combined, deadline }, async () => {
      const result = await action(combined);
      combined.throwIfAborted();
      return result;
    });
  } finally {
    clearTimeout(timer);
  }
}

export function outsideOperationBudget<T>(
  action: () => Promise<T>,
): Promise<T> {
  return current.run(undefined, action);
}

/** A shared producer has another caller's lifetime. Stop waiting on it
 * without cancelling their work, and prevent a queued mutation starting late. */
export async function waitWithinOperation<T>(work: Promise<T>): Promise<T> {
  const signal = operationSignal();
  if (signal === undefined) return work;
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort);
  }
}
