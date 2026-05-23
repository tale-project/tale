'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

export function SwUpdateListener() {
  const { t } = useT('pwa');
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

    toast({
      duration: 60_000,
      title: t('updateAvailableTitle'),
      description: t('updateAvailableDescription'),
      action: (
        <ToastPrimitives.Action
          altText={t('updateNow')}
          asChild
          onClick={() => {
            void updateServiceWorker(true);
          }}
        >
          <button
            type="button"
            className="bg-foreground text-background inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90"
          >
            {t('updateNow')}
          </button>
        </ToastPrimitives.Action>
      ),
    });
  }, [needRefresh, updateServiceWorker, t]);

  useEffect(() => {
    if (!offlineReady) return;
    toast({
      duration: 4_000,
      title: t('offlineReady'),
    });
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, t]);

  return null;
}
