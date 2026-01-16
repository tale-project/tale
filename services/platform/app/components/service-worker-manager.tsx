'use client';

import { useEffect } from 'react';
import { ServiceWorkerUpdatePrompt } from './service-worker-update-prompt';
import { OfflineIndicator } from './offline-indicator';
import { useOnlineStatusWithCallback } from '@/app/hooks/use-online-status';
import { useServiceWorker } from '@/app/hooks/use-service-worker';

interface ServiceWorkerManagerProps {
  showOfflineIndicator?: boolean;
  showUpdatePrompt?: boolean;
}

export function ServiceWorkerManager({
  showOfflineIndicator = true,
  showUpdatePrompt = true,
}: ServiceWorkerManagerProps) {
  const { isSupported, isRegistered, error } = useServiceWorker();

  const isOnline = useOnlineStatusWithCallback(
    () => {
      console.log('Connection restored');
    },
    () => {
      console.log('Connection lost');
    }
  );

  useEffect(() => {
    if (error) {
      console.error('Service Worker error:', error);
    }
  }, [error]);

  useEffect(() => {
    if (isRegistered) {
      console.log('Service Worker is active and ready');
    }
  }, [isRegistered]);

  if (!isSupported) {
    return null;
  }

  return (
    <>
      {showOfflineIndicator && <OfflineIndicator showWhenOnline={!isOnline} />}
      {showUpdatePrompt && <ServiceWorkerUpdatePrompt />}
    </>
  );
}
