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
 *
 * Failed requests alone are not enough, though: TanStack Query pauses its
 * fetches while `navigator.onLine` is false, and an idle tab issues none, so
 * a dropped network left the last data on screen for as long as the user
 * did not click (2026-09-26 evaluation, G-06). `probeBackend` asks
 * `/api/health` directly — on the `offline` event, when the hint stream
 * errors, and every {@link PROBE_INTERVAL_MS} while the device is offline or
 * the backend is flagged unreachable — so the overlay appears within seconds
 * of an outage and clears on its own once the backend answers again.
 */
let reachable = true;
const listeners = new Set<() => void>();

/** A probe that gets no response within this window counts as unreachable. */
const PROBE_TIMEOUT_MS = 4_000;
/** How often the backend is re-probed while offline or unreachable. */
export const PROBE_INTERVAL_MS = 5_000;

let inflightProbe: Promise<boolean> | undefined;
let watchTimer: ReturnType<typeof setTimeout> | undefined;
let windowListenersAttached = false;

function publish(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  for (const listener of listeners) listener();
  syncWatch();
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

function isDeviceOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * Ask the backend whether it is there. Any HTTP response — a 404 from the dev
 * server, a 503 while a deployment drains — proves the server answers; only
 * a fetch that never gets a response (refused, DNS, offline, timed out)
 * marks it unreachable. Bypasses every cache so a stale answer cannot
 * masquerade as a live one. Concurrent callers share one in-flight probe.
 */
export function probeBackend(): Promise<boolean> {
  if (inflightProbe !== undefined) return inflightProbe;
  const basePath = window.__ENV__?.BASE_PATH ?? '';
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  inflightProbe = fetch(`${basePath}/api/health`, {
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(() => {
      publish(true);
      return true;
    })
    .catch((error: unknown) => {
      console.warn('[backend-connection] health probe failed:', error);
      publish(false);
      return false;
    })
    .finally(() => {
      clearTimeout(timeout);
      inflightProbe = undefined;
      syncWatch();
    });
  return inflightProbe;
}

/**
 * Probe unless one is in flight or the watch loop is about to — the entry
 * point for noisy signals such as the hint stream's `error`, which fires on
 * every failed reconnect attempt.
 */
export function probeBackendSoon(): void {
  if (inflightProbe !== undefined || watchTimer !== undefined) return;
  void probeBackend();
}

/** Keep probing only while someone listens and the state is in doubt. */
function shouldWatch(): boolean {
  return listeners.size > 0 && (!reachable || isDeviceOffline());
}

function syncWatch(): void {
  if (shouldWatch()) {
    if (watchTimer !== undefined) return;
    watchTimer = setTimeout(() => {
      watchTimer = undefined;
      void probeBackend();
    }, PROBE_INTERVAL_MS);
    return;
  }
  if (watchTimer !== undefined) {
    clearTimeout(watchTimer);
    watchTimer = undefined;
  }
}

/** The device's own verdict changed: verify it against the backend now. */
function onConnectivityChange(): void {
  void probeBackend();
}

function attachWindowListeners(): void {
  if (windowListenersAttached || typeof window === 'undefined') return;
  windowListenersAttached = true;
  window.addEventListener('offline', onConnectivityChange);
  window.addEventListener('online', onConnectivityChange);
}

function detachWindowListeners(): void {
  if (!windowListenersAttached) return;
  windowListenersAttached = false;
  window.removeEventListener('offline', onConnectivityChange);
  window.removeEventListener('online', onConnectivityChange);
}

export function useBackendReachable(): boolean {
  const [value, setValue] = useState(isBackendReachable);
  useEffect(() => {
    const listener = (): void => {
      setValue(reachable);
    };
    listeners.add(listener);
    listener();
    attachWindowListeners();
    syncWatch();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        detachWindowListeners();
      }
      syncWatch();
    };
  }, []);
  return value;
}
