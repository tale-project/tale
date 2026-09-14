'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { SwUpdateListener } from '@tale/ui/pwa/sw-update-listener';
import { Text } from '@tale/ui/text';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Docs PWA wiring. Renders a small fixed card when a new service worker is
 * waiting, prompting the reader to reload for the latest docs. Offline-ready
 * announcements are surfaced as a one-shot card removed automatically after a
 * few seconds.
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
        <Card
          role="status"
          aria-live="polite"
          padding="md"
          shadow="md"
          className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Text variant="label">{updateAction.title}</Text>
            <Text variant="caption">{updateAction.description}</Text>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setUpdateAction(null)}
            >
              {t('dismiss')}
            </Button>
            <Button type="button" size="sm" onClick={updateAction.onUpdate}>
              {updateAction.buttonLabel}
            </Button>
          </div>
        </Card>
      ) : null}
      {offlineReady ? (
        <Card
          role="status"
          aria-live="polite"
          padding="md"
          shadow="md"
          className="fixed right-4 bottom-4 z-50 max-w-sm"
        >
          <Text variant="label">{offlineReady}</Text>
        </Card>
      ) : null}
    </>
  );
}
