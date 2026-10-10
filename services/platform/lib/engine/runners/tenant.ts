/**
 * Whose evaluations these are, for the runner pool's fairness: the pool
 * keeps one queue per tenant and serves the queues in turn, so one
 * organization's burst of evaluations waits behind its own work, not in
 * front of everyone else's. A host names the tenant around the work it
 * starts — the stepper a run's turn, an in-process host a request — and
 * nothing in the engine has to pass it along. Work started outside any
 * tenant shares one queue.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const tenants = new AsyncLocalStorage<string>();

/** Run `fn` with every evaluation it starts queued under `key`. */
export function withRunnerTenant<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenants.run(key, fn);
}

/** The tenant the current evaluation belongs to: `''` outside any. */
export function currentRunnerTenant(): string {
  return tenants.getStore() ?? '';
}
