import { useEffect, useState, useCallback } from 'react';

import {
  registerServiceWorker,
  checkForServiceWorkerUpdate,
  skipWaiting,
} from '@/lib/service-worker';

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
  error: Error | null;
}

export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
    error: null,
  });

  const handleUpdate = useCallback(
    (registration: ServiceWorkerRegistration) => {
      setState((prev) => ({
        ...prev,
        isUpdateAvailable: true,
        registration,
      }));
    },
    [],
  );

  const handleSuccess = useCallback(
    (registration: ServiceWorkerRegistration) => {
      setState((prev) => ({
        ...prev,
        isRegistered: true,
        registration,
      }));
    },
    [],
  );

  const handleError = useCallback((error: Error) => {
    setState((prev) => ({
      ...prev,
      error,
    }));
  }, []);

  const applyUpdate = useCallback(() => {
    const handleControllerChange = () => {
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
    );

    if (state.registration?.waiting) {
      skipWaiting(state.registration.waiting);
    } else {
      window.location.reload();
    }
  }, [state.registration]);

  const checkForUpdate = useCallback(async () => {
    const hasUpdate = await checkForServiceWorkerUpdate();
    if (hasUpdate) {
      setState((prev) => ({
        ...prev,
        isUpdateAvailable: true,
      }));
    }
  }, []);

  useEffect(() => {
    const isSupported =
      typeof window !== 'undefined' && 'serviceWorker' in navigator;

    setState((prev) => ({
      ...prev,
      isSupported,
    }));

    if (!isSupported) {
      return;
    }

    void registerServiceWorker({
      onSuccess: handleSuccess,
      onUpdate: handleUpdate,
      onError: handleError,
    });

    const interval = setInterval(
      () => {
        void checkForUpdate();
      },
      60 * 60 * 1000,
    );

    return () => {
      clearInterval(interval);
    };
  }, [handleSuccess, handleUpdate, handleError, checkForUpdate]);

  return {
    ...state,
    applyUpdate,
    checkForUpdate,
  };
}
