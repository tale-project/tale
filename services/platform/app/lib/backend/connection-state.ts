import { useEffect, useState } from 'react';

/**
 * Whether the app can reach its backend right now — the signal the offline
 * overlay reasons on, and the 0.5 replacement for the Convex WebSocket's
 * connection state.
 *
 * There is no persistent socket to watch any more: every read is an
 * authenticated HTTP request, and the only always-on lane is the org's
 * `/events` hint stream. So reachability is reported by the two things that
 * actually know — the hint stream's own open/error transitions, and the
 * browser's `navigator.onLine` — and stays OPTIMISTIC until something fails:
 * a request that has not been tried is not evidence of an outage.
 */
let reachable = true;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  for (const listener of listeners) listener();
}

/** The hint stream opened — the backend is answering. */
export function reportBackendReachable(): void {
  publish(true);
}

/** The hint stream dropped — the backend is unreachable from here. The
 * browser reconnects on its own, which re-reports reachable. */
export function reportBackendUnreachable(): void {
  publish(false);
}

export function useBackendReachable(): boolean {
  const [value, setValue] = useState(reachable);
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
