'use client';

import { SwUpdateListener } from '@tale/ui/pwa/sw-update-listener';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Docs PWA wiring. Renders a small fixed banner when a new service
 * worker is waiting, prompting the reader to reload for the latest
 * docs. Offline-ready announcements are surfaced as a one-shot toast
 * removed automatically after a few seconds.
 */
export function SwUpdateBanner() {
  const { t } = useT('pwa');
  const [updateAction, setUpdateAction] = useState<null | {
    onUpdate: () => void;
    title: string;
    description: string;
    buttonLabel: string;
  }>(null);
  const [offlineReady, setOfflineReady] = useState<string | null>(null);

  useEffect(() => {
    if (!offlineReady) return undefined;
    const id = window.setTimeout(() => setOfflineReady(null), 4_000);
    return () => window.clearTimeout(id);
  }, [offlineReady]);

  return (
    <>
      <SwUpdateListener
        labels={{
          updateAvailableTitle: t('updateAvailableTitle'),
          updateAvailableDescription: t('updateAvailableDescription'),
          updateNow: t('updateNow'),
          offlineReady: t('offlineReady'),
        }}
        renderUpdateToast={({ labels, onUpdate }) => {
          setUpdateAction({
            onUpdate,
            title: labels.updateAvailableTitle,
            description: labels.updateAvailableDescription,
            buttonLabel: labels.updateNow,
          });
        }}
        renderOfflineReadyToast={({ labels }) => {
          setOfflineReady(labels.offlineReady);
        }}
      />
      {updateAction ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border-base bg-bg-base fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-3 rounded-lg border p-4 shadow-lg"
        >
          <div className="flex flex-col gap-1">
            <p className="text-fg-base text-sm font-medium">
              {updateAction.title}
            </p>
            <p className="text-fg-muted text-xs">{updateAction.description}</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setUpdateAction(null)}
              className="text-fg-muted hover:text-fg-base inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-colors"
            >
              {t('dismiss')}
            </button>
            <button
              type="button"
              onClick={updateAction.onUpdate}
              className="bg-fg-base text-bg-base inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90"
            >
              {updateAction.buttonLabel}
            </button>
          </div>
        </div>
      ) : null}
      {offlineReady ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border-base bg-bg-base fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border px-4 py-3 shadow-lg"
        >
          <p className="text-fg-base text-sm font-medium">{offlineReady}</p>
        </div>
      ) : null}
    </>
  );
}
