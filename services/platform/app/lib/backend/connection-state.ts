import { useEffect, useState } from 'react';

/**
 * Whether the app can reach its backend right now — the signal the offline
 * overlay reasons on, and the 0.5 replacement for the Convex WebSocket's
 * connection state.
 *
 * There is no persistent socket to watch any more: every read is an
 * authenticated HTTP request. Reachability is OPTIMISTIC until an HTTP
 * `fetch` to the backend fails to get a response (refused, DNS, offline).
 * The `/events` hint stream is not this signal — EventSource fires `error`
 * on proxy blips and its own reconnects, which is not "the server is down".
 */
let reachable = true;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  for (const listener of listeners) listener();
}

/** An HTTP request reached the backend (any status). */
export function reportBackendReachable(): void {
  publish(true);
}

/** An HTTP request never got a response — the backend is unreachable. */
export function reportBackendUnreachable(): void {
  publish(false);
}

/** Sync snapshot for tests and for the hook's first paint. */
export function isBackendReachable(): boolean {
  return reachable;
}

export function useBackendReachable(): boolean {
  const [value, setValue] = useState(isBackendReachable);
  useEffect(() => {
    const listener = (): void => {
      setValue(reachable);
    };
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
