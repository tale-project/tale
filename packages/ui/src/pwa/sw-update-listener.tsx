'use client';

/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
// vite-plugin-pwa generates this virtual module at build time. Consuming
// services must add the plugin to their vite.config.ts (see
// `@tale/ui/pwa/vite-plugin`) and reference `vite-plugin-pwa/client` and
// `vite-plugin-pwa/react` in their `vite-env.d.ts` for the types.
import { useRegisterSW } from 'virtual:pwa-register/react';

import {
  activateWaitingWorker,
  watchServiceWorker,
} from './watch-service-worker';

export interface SwUpdateListenerLabels {
  /** Toast title shown when a new service worker is waiting. */
  updateAvailableTitle: string;
  /** Toast description shown when a new service worker is waiting. */
  updateAvailableDescription: string;
  /** Action button label inside the update toast. */
  updateNow: string;
  /** Dismiss label inside the update toast — the page keeps its version. */
  updateLater: string;
  /** Toast title shown when the offline connection screen is cached. */
  offlineReady: string;
}

/** Whether a service worker already controls this page. A page without one
 * is a first install (or a hard reload): there is no older version to
 * update FROM, so a "new version is ready" prompt would be false. */
function hasControllingServiceWorker(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.serviceWorker?.controller != null
  );
}

interface SwUpdateListenerProps {
  labels: SwUpdateListenerLabels;
  /**
   * Show a persistent toast prompting the user to reload when a new
   * service worker is waiting. Receives an `onUpdate` callback that
   * triggers the service-worker update and a reload.
   */
  renderUpdateToast: (input: {
    labels: SwUpdateListenerLabels;
    onUpdate: () => void;
  }) => void;
  /** Brief notice shown once the service worker has cached the offline screen. */
  renderOfflineReadyToast: (input: { labels: SwUpdateListenerLabels }) => void;
}

/**
 * Service-worker update listener. Renders nothing; delegates toast UI to
 * the caller so each app can use its own toast system. Wire it into
 * the app shell once and it will:
 *  - check for releases in long-lived tabs and prompt when a worker waits
 *  - announce that the offline screen is ready the first time (`offlineReady`)
 *
 * Requires `vite-plugin-pwa` to be configured in the consuming service.
 */
export function SwUpdateListener({
  labels,
  renderUpdateToast,
  renderOfflineReadyToast,
}: SwUpdateListenerProps): ReactNode {
  const prompted = useRef(new WeakSet<ServiceWorker>());
  const activating = useRef(new WeakSet<ServiceWorker>());
  const activations = useRef(new Set<() => void>());
  const reloading = useRef(false);
  const reloadOnce = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    window.location.reload();
  }, []);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onNeedReload: reloadOnce,
    onRegisteredSW(_url, registered) {
      if (registered) setRegistration(registered);
    },
    // The browser decides this (private mode, workers disabled, no storage),
    // and the page works without a worker, so it is a warning, not an error.
    onRegisterError(error) {
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!registration) return undefined;
    return watchServiceWorker(registration, (worker) => {
      if (!hasControllingServiceWorker() || prompted.current.has(worker))
        return;
      prompted.current.add(worker);
      renderUpdateToast({
        labels,
        onUpdate: () => {
          if (activating.current.has(worker)) return;
          activating.current.add(worker);
          reloading.current = false;
          const failed = (error: unknown): void => {
            activating.current.delete(worker);
            prompted.current.delete(worker);
            console.warn('Service worker activation failed', error);
          };
          try {
            activations.current.add(
              activateWaitingWorker(worker, reloadOnce, failed),
            );
          } catch (error) {
            failed(error);
          }
        },
      });
    });
  }, [registration, labels, renderUpdateToast, reloadOnce]);

  useEffect(() => {
    const stops = activations.current;
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    renderOfflineReadyToast({ labels });
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, labels, renderOfflineReadyToast]);

  return null;
}
