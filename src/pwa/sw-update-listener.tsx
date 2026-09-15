'use client';

/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

import { useEffect, useRef, type ReactNode } from 'react';
// vite-plugin-pwa generates this virtual module at build time. Consuming
// services must add the plugin to their vite.config.ts (see
// `@tale/ui/pwa/vite-plugin`) and reference `vite-plugin-pwa/client` and
// `vite-plugin-pwa/react` in their `vite-env.d.ts` for the types.
import { useRegisterSW } from 'virtual:pwa-register/react';

export interface SwUpdateListenerLabels {
  /** Toast title shown when a new service worker is waiting. */
  updateAvailableTitle: string;
  /** Toast description shown when a new service worker is waiting. */
  updateAvailableDescription: string;
  /** Action button label inside the update toast. */
  updateNow: string;
  /** Toast title shown the first time the app is cached for offline use. */
  offlineReady: string;
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
  /** Brief notice shown once the service worker has cached the app. */
  renderOfflineReadyToast: (input: { labels: SwUpdateListenerLabels }) => void;
}

/**
 * Service-worker update listener. Renders nothing; delegates toast UI to
 * the caller so each app can use its own toast system. Wire it into
 * the app shell once and it will:
 *  - prompt the user to reload when a new SW is waiting (`needRefresh`)
 *  - announce that the app is ready offline the first time (`offlineReady`)
 *
 * Requires `vite-plugin-pwa` to be configured in the consuming service.
 */
export function SwUpdateListener({
  labels,
  renderUpdateToast,
  renderOfflineReadyToast,
}: SwUpdateListenerProps): ReactNode {
  const firedRef = useRef(false);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!needRefresh || firedRef.current) return;
    firedRef.current = true;
    renderUpdateToast({
      labels,
      onUpdate: () => {
        void updateServiceWorker(true);
      },
    });
  }, [needRefresh, updateServiceWorker, labels, renderUpdateToast]);

  useEffect(() => {
    if (!offlineReady) return;
    renderOfflineReadyToast({ labels });
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, labels, renderOfflineReadyToast]);

  return null;
}
