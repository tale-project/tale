'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { SwUpdateListener as SharedSwUpdateListener } from '@tale/ui/pwa/sw-update-listener';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

export function SwUpdateListener() {
  const { t } = useT('pwa');

  return (
    <SharedSwUpdateListener
      labels={{
        updateAvailableTitle: t('updateAvailableTitle'),
        updateAvailableDescription: t('updateAvailableDescription'),
        updateNow: t('updateNow'),
        offlineReady: t('offlineReady'),
      }}
      renderUpdateToast={({ labels, onUpdate }) => {
        toast({
          duration: 60_000,
          title: labels.updateAvailableTitle,
          description: labels.updateAvailableDescription,
          action: (
            <ToastPrimitives.Action
              altText={labels.updateNow}
              asChild
              onClick={onUpdate}
            >
              <button
                type="button"
                className="bg-foreground text-background inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90"
              >
                {labels.updateNow}
              </button>
            </ToastPrimitives.Action>
          ),
        });
      }}
      renderOfflineReadyToast={({ labels }) => {
        toast({
          duration: 4_000,
          title: labels.offlineReady,
        });
      }}
    />
  );
}
