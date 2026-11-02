// Exit-IP checks of the pool's proxies, run in the background and stored on the
// proxy.
//
// A proxy is never checked twice at the same time. Queued checks (new proxies,
// Check, Check all) run `CHECK_CONCURRENCY` at a time; `check()` (an assignment
// or a start pre-flight) runs at once, or joins the proxy's running check, and
// returns the fresh result.

import type { Store } from '../../db/store.ts';
import { CancelledError, abortable } from '../../lib/abort.ts';
import { ExitIpError } from './types.ts';
import type { ExitIp, ExitIpChecker } from './types.ts';

export const CHECK_CONCURRENCY = 8;

/** How a check ended, for whoever waits for it. */
type Outcome =
  | { kind: 'done'; result: ExitIp | ExitIpError }
  /** The check itself broke (the store failed): not a verdict on the proxy. */
  | { kind: 'broken'; error: unknown }
  /** The checks were closed before it finished. */
  | { kind: 'cancelled' };

/** A check that is queued or running. */
interface Check {
  /** Set the moment something takes it on, so that only one run ever does. */
  started: boolean;
  readonly outcome: Promise<Outcome>;
  settle(outcome: Outcome): void;
}

function newCheck(): Check {
  const { promise, resolve } = Promise.withResolvers<Outcome>();
  return { started: false, outcome: promise, settle: resolve };
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** At most `limit` holders at a time, served in the order they asked. */
class Slots {
  readonly #limit: number;
  #taken = 0;
  #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  async acquire(): Promise<void> {
    if (this.#taken < this.#limit) {
      this.#taken += 1;
      return;
    }
    // The slot is handed over: `#taken` stays as it is.
    await new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next === undefined) this.#taken -= 1;
    else next();
  }

  /** Nobody waits any more: the queued checks are dropped. */
  drop(): void {
    this.#waiting = [];
  }
}

export interface ProxyChecksOptions {
  /** How many queued checks run at once. Default `CHECK_CONCURRENCY`. */
  concurrency?: number;
}

export class ProxyChecks {
  readonly #store: Store;
  readonly #checker: ExitIpChecker;
  readonly #slots: Slots;
  /** Queued or running. */
  readonly #checks = new Map<number, Check>();
  #closed = false;

  constructor(
    store: Store,
    checker: ExitIpChecker,
    options: ProxyChecksOptions = {},
  ) {
    this.#store = store;
    this.#checker = checker;
    this.#slots = new Slots(options.concurrency ?? CHECK_CONCURRENCY);
  }

  /** Is a check of the proxy queued or running? */
  isChecking(proxyId: number): boolean {
    return this.#checks.has(proxyId);
  }

  /** Checks in the background, unless a check is already queued or running. */
  queue(proxyIds: Iterable<number>): void {
    if (this.#closed) return;
    for (const proxyId of proxyIds) {
      if (!this.#checks.has(proxyId)) {
        this.#spawn(this.#queued(proxyId, this.#new(proxyId)));
      }
    }
  }

  /**
   * Checks now, ahead of the queue, and returns the result that is stored.
   * Rejects with an `ExitIpError` when the proxy does not work. Aborting
   * `signal` ends the wait and leaves the check running: its result is still
   * stored.
   */
  async check(
    proxyId: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExitIp> {
    if (this.#closed) throw new CancelledError('the proxy checks are closed');
    const check = this.#checks.get(proxyId) ?? this.#new(proxyId);
    if (!check.started) this.#spawn(this.#run(proxyId, check));
    const { signal } = options;
    const outcome = await (signal === undefined
      ? check.outcome
      : abortable(check.outcome, signal));
    if (outcome.kind === 'cancelled') {
      throw new CancelledError('the proxy checks were closed');
    }
    if (outcome.kind === 'broken') throw outcome.error;
    // A new error for each caller, so that no two share a stack.
    if (outcome.result instanceof ExitIpError) {
      throw new ExitIpError(outcome.result.message);
    }
    return outcome.result;
  }

  /**
   * Stops for good: nothing is queued or started any more, whoever waits for a
   * check is told it was cancelled and a check that is under way finishes
   * unrecorded (the checker cannot be interrupted, and the store is about to
   * close).
   */
  async aclose(): Promise<void> {
    this.#closed = true;
    this.#slots.drop();
    for (const check of this.#checks.values()) {
      check.settle({ kind: 'cancelled' });
    }
    this.#checks.clear();
  }

  #new(proxyId: number): Check {
    const check = newCheck();
    this.#checks.set(proxyId, check);
    return check;
  }

  #spawn(task: Promise<void>): void {
    void task.catch((error: unknown) => {
      console.error('an exit-IP check task failed', error);
    });
  }

  async #queued(proxyId: number, check: Check): Promise<void> {
    await this.#slots.acquire();
    try {
      // Else `check()` took it out of the queue.
      if (!check.started && !this.#closed) await this.#run(proxyId, check);
    } finally {
      this.#slots.release();
    }
  }

  async #run(proxyId: number, check: Check): Promise<void> {
    check.started = true;
    try {
      const result = await this.#check(proxyId);
      // Closed meanwhile: the store may be gone, the waiters have been told.
      if (!this.#closed) {
        if (result instanceof ExitIpError) {
          this.#store.recordCheckFailed(proxyId, result.message);
        } else {
          this.#store.recordCheckOk(proxyId, result);
        }
      }
      check.settle({ kind: 'done', result });
    } catch (error) {
      check.settle({ kind: 'broken', error });
      throw error;
    } finally {
      if (this.#checks.get(proxyId) === check) this.#checks.delete(proxyId);
      // A no-op once there is an outcome.
      check.settle({ kind: 'cancelled' });
    }
  }

  async #check(proxyId: number): Promise<ExitIp | ExitIpError> {
    const proxy = this.#store.getProxy(proxyId);
    if (proxy === null) return new ExitIpError('the proxy was deleted');
    try {
      return await this.#checker.check(proxy.config);
    } catch (error) {
      if (error instanceof ExitIpError) return error;
      // Neither the message nor the proxy is shown: either could hold a credential.
      console.error(`exit-IP check of proxy ${proxyId} failed`, error);
      return new ExitIpError(`the check failed (${nameOf(error)})`);
    }
  }
}
