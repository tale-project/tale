import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * Writes of one governance policy from this tab, kept in order (#4048).
 *
 * A policy write carries the whole file, built from the config its caller
 * last read. When two writes are in flight at once, the network decides
 * which one lands last, and the last one wins. That is how a header
 * switch's slow write put back the settings of a Save made while it was
 * pending, with nothing reporting it. So each write of a policy waits until
 * the one before it has settled.
 *
 * A policy is also *settling* until its read has been fetched again after
 * a write. Until then, the saved config a switch would build its next write
 * from is the config that write replaced.
 */

/** The last write queued for each policy. It never rejects. */
const tails = new Map<string, Promise<void>>();
/** How many writes and re-reads of each policy are still in flight. */
const inFlight = new Map<string, number>();
const listeners = new Set<() => void>();

function keyOf(organizationId: string, policyType: string): string {
  return JSON.stringify([organizationId, policyType]);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Count `key` as in flight until the returned release runs. */
function hold(key: string): () => void {
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  notify();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (inFlight.get(key) ?? 1) - 1;
    if (left > 0) inFlight.set(key, left);
    else inFlight.delete(key);
    notify();
  };
}

/**
 * Run `write` once every earlier write of the same policy from this tab
 * has settled, whether or not it succeeded.
 */
export function inPolicyWriteOrder<T>(
  organizationId: string,
  policyType: string,
  write: () => Promise<T>,
): Promise<T> {
  const key = keyOf(organizationId, policyType);
  const release = hold(key);
  const result = (tails.get(key) ?? Promise.resolve()).then(write);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
    release();
  });
  return result;
}

/**
 * Keep the policy settling until its read, `queryKey`, is no longer being
 * fetched. A live hint can invalidate the same read while it is in flight
 * and replace that fetch with a new one. The policy then stays settling
 * until the replacement lands too. A read nobody is showing is not fetched
 * again, and the hold ends at once.
 */
export function settleUntilRead(
  client: QueryClient,
  organizationId: string,
  policyType: string,
  queryKey: QueryKey,
): void {
  const cache = client.getQueryCache();
  const fetching = () =>
    (cache.find({ queryKey, exact: true })?.state.fetchStatus ?? 'idle') !==
    'idle';
  if (!fetching()) return;
  const release = hold(keyOf(organizationId, policyType));
  const unsubscribe = cache.subscribe(() => {
    if (fetching()) return;
    unsubscribe();
    release();
  });
}

/**
 * Whether a write of this policy from this tab, or the re-read after one,
 * is still in flight.
 */
export function isPolicySettling(
  organizationId: string,
  policyType: string,
): boolean {
  return inFlight.has(keyOf(organizationId, policyType));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** {@link isPolicySettling}, kept current in a component. */
export function usePolicySettling(
  organizationId: string,
  policyType: string,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isPolicySettling(organizationId, policyType),
    () => false,
  );
}
