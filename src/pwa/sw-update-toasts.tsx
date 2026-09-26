'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import { SwUpdateListener as SharedSwUpdateListener } from '@tale/ui/pwa/sw-update-listener';
import { toast } from '@tale/ui/use-toast';

export function SwUpdateToasts() {
  const { t } = useT('pwa');

  return (
    <SharedSwUpdateListener
      labels={{
        updateAvailableTitle: t('updateAvailableTitle'),
        updateAvailableDescription: t('updateAvailableDescription'),
        updateNow: t('updateNow'),
        updateLater: t('updateLater'),
        offlineReady: t('offlineReady'),
      }}
      renderUpdateToast={({ labels, onUpdate }) => {
        // A minute-long toast sat on the primary controls (it covered
        // "Create project" and, on a phone, the account menu) and the
        // toaster has no close control — so the prompt is short-lived and
        // carries its own "Later"; the update stays one reload away.
        toast({
          duration: 15_000,
          title: labels.updateAvailableTitle,
          description: labels.updateAvailableDescription,
          action: (
            <div className="flex shrink-0 items-center gap-2">
              <ToastPrimitives.Close asChild>
                <Button type="button" variant="ghost" size="sm">
                  {labels.updateLater}
                </Button>
              </ToastPrimitives.Close>
              <ToastPrimitives.Action
                altText={labels.updateNow}
                asChild
                onClick={onUpdate}
              >
                <Button type="button" variant="primary" size="sm">
                  {labels.updateNow}
                </Button>
              </ToastPrimitives.Action>
            </div>
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
