import { useEffect, useState } from 'react';

/**
 * Whether the app can reach its backend right now — the signal the offline
 * overlay reasons on, and the 0.5 replacement for the Convex WebSocket's
 * connection state.
 *
 * There is no persistent socket to watch any more: every read is an
 * authenticated HTTP request. Reachability is OPTIMISTIC until an HTTP
 * `fetch` fails or the API/proxy reports the platform unavailable.
 * The `/events` hint stream is not this signal — EventSource fires `error`
 * on proxy blips and its own reconnects, which is not "the server is down".
 *
 * Failed requests alone are not enough, though: TanStack Query pauses its
 * fetches while `navigator.onLine` is false, and an idle tab issues none, so
 * a dropped network left the last data on screen for as long as the user
 * did not click (2026-09-26 evaluation, G-06). `probeBackend` asks
 * `/api/health/ready` directly — on connectivity/resume events, when the hint stream
 * errors, and every {@link PROBE_INTERVAL_MS} while the device is offline or
 * the backend is flagged unreachable — so the overlay appears within seconds
 * of an outage and clears on its own once the API and database answer again.
 * Healthy idle tabs are checked every 30 seconds as well.
 */
let reachable = true;
const listeners = new Set<() => void>();

/** A probe that gets no response within this window counts as unreachable
 * — long enough that a slow answer (a cold pod, a busy proxy) is not
 * read as an outage. */
export const PROBE_TIMEOUT_MS = 8_000;
/** How often the backend is re-probed while offline or unreachable. */
export const PROBE_INTERVAL_MS = 5_000;
/** Detect a silent proxy/SSE failure even in an idle, online tab. */
export const HEALTHY_PROBE_INTERVAL_MS = 30_000;
/** While reachable and online, {@link probeBackendSoon} probes at most
 * this often — the hint stream fires `error` on every reconnect attempt. */
export const PROBE_SOON_MIN_GAP_MS = 10_000;

let inflightProbe: Promise<boolean> | undefined;
let lastProbeStartedAt = Number.NEGATIVE_INFINITY;
let watchTimer: ReturnType<typeof setTimeout> | undefined;
let windowListenersAttached = false;
let evidenceRevision = 0;

function publish(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  clearTimeout(watchTimer);
  watchTimer = undefined;
  for (const listener of listeners) listener();
  syncWatch();
}

/** A successful API call or an ordinary application refusal reached the backend. */
export function reportBackendReachable(): void {
  evidenceRevision += 1;
  publish(true);
}

/** A transport failed or the platform's API/database is unavailable. */
export function reportBackendUnreachable(): void {
  evidenceRevision += 1;
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
 * Ask the API and database whether they can serve work. Only the readiness
 * door's successful JSON verdict proves it: an FRP/Cloudflare error page, a
 * redirect, or the independently healthy web process cannot clear an outage.
 * Bypasses every cache so a stale answer cannot
 * masquerade as a live one. Concurrent callers share one in-flight probe.
 */
export function probeBackend(): Promise<boolean> {
  if (inflightProbe !== undefined) return inflightProbe;
  const basePath = window.__ENV__?.BASE_PATH ?? '';
  lastProbeStartedAt = Date.now();
  const controller = new AbortController();
  const startedAtRevision = evidenceRevision;
  const timeout = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  inflightProbe = fetch(`${basePath}/api/health/ready`, {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: controller.signal,
  })
    .then(async (response) => {
      let ready = false;
      if (response.status === 200) {
        const body: unknown = await response.json();
        ready =
          body !== null &&
          typeof body === 'object' &&
          'ok' in body &&
          body.ok === true &&
          'service' in body &&
          body.service === 'backend';
      } else {
        void response.body?.cancel();
      }
      if (startedAtRevision === evidenceRevision) publish(ready);
      return reachable;
    })
    .catch((error: unknown) => {
      console.warn('[backend-connection] health probe failed:', error);
      if (startedAtRevision === evidenceRevision) publish(false);
      return reachable;
    })
    .finally(() => {
      clearTimeout(timeout);
      inflightProbe = undefined;
      syncWatch();
    });
  return inflightProbe;
}

/**
 * Probe unless one is in flight, the watch loop is about to, or — while
 * nothing is in doubt (reachable, device online) — one ran within
 * {@link PROBE_SOON_MIN_GAP_MS}: the entry point for noisy signals such as
 * the hint stream's `error`, which fires on every failed reconnect attempt.
 */
export function probeBackendSoon(): void {
  if (inflightProbe !== undefined) return;
  if (watchTimer !== undefined && (!reachable || isDeviceOffline())) return;
  if (
    reachable &&
    !isDeviceOffline() &&
    Date.now() - lastProbeStartedAt < PROBE_SOON_MIN_GAP_MS
  ) {
    return;
  }
  void probeBackend();
}

function syncWatch(): void {
  if (listeners.size > 0 && inflightProbe === undefined) {
    if (watchTimer !== undefined) return;
    watchTimer = setTimeout(
      () => {
        watchTimer = undefined;
        void probeBackend();
      },
      !reachable || isDeviceOffline()
        ? PROBE_INTERVAL_MS
        : HEALTHY_PROBE_INTERVAL_MS,
    );
    return;
  }
  if (watchTimer !== undefined) {
    clearTimeout(watchTimer);
    watchTimer = undefined;
  }
}

/** The device's own verdict changed: verify it against the backend now. */
function onConnectivityChange(): void {
  clearTimeout(watchTimer);
  watchTimer = undefined;
  void probeBackend();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') onConnectivityChange();
}

function attachWindowListeners(): void {
  if (windowListenersAttached || typeof window === 'undefined') return;
  windowListenersAttached = true;
  window.addEventListener('offline', onConnectivityChange);
  window.addEventListener('online', onConnectivityChange);
  window.addEventListener('focus', onConnectivityChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function detachWindowListeners(): void {
  if (!windowListenersAttached) return;
  windowListenersAttached = false;
  window.removeEventListener('offline', onConnectivityChange);
  window.removeEventListener('online', onConnectivityChange);
  window.removeEventListener('focus', onConnectivityChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

/** Non-React recovery uses the same probe loop as the connection overlay. */
export function subscribeBackendReachability(listener: () => void): () => void {
  listeners.add(listener);
  attachWindowListeners();
  syncWatch();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachWindowListeners();
    syncWatch();
  };
}

export function useBackendReachable(): boolean {
  const [value, setValue] = useState(isBackendReachable);
  useEffect(() => {
    const listener = (): void => {
      setValue(reachable);
    };
    const unsubscribe = subscribeBackendReachability(listener);
    listener();
    return unsubscribe;
  }, []);
  return value;
}
