interface ServiceWorkerCallbacks {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: Error) => void;
}

export async function registerServiceWorker(
  callbacks: ServiceWorkerCallbacks = {},
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const isLocalDev =
    import.meta.env.DEV ||
    window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.local');

  if (isLocalDev) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (
          newWorker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          callbacks.onUpdate?.(registration);
        } else if (newWorker.state === 'activated') {
          callbacks.onSuccess?.(registration);
        }
      });
    });

    if (registration.active) {
      callbacks.onSuccess?.(registration);
    }

    return registration;
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    callbacks.onError?.(errorObj);
    return null;
  }
}

export async function checkForServiceWorkerUpdate(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;

    await registration.update();

    return registration.waiting !== null;
  } catch (error) {
    console.error('Failed to check for service worker update:', error);
    return false;
  }
}

export function skipWaiting(waitingWorker: ServiceWorker): void {
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage does not accept targetOrigin
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}
