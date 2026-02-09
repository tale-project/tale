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
  waitingWorker.postMessage({ type: 'SKIP_WAITING' }, '/');
}

interface SyncRegistration extends ServiceWorkerRegistration {
  sync: {
    register: (tag: string) => Promise<void>;
    getTags: () => Promise<string[]>;
  };
}

export async function registerBackgroundSync(
  tag: string = 'mutation-sync',
): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = (await navigator.serviceWorker
      .ready) as SyncRegistration;

    if (!('sync' in registration)) {
      return false;
    }

    await registration.sync.register(tag);
    return true;
  } catch (error) {
    console.error('Failed to register background sync:', error);
    return false;
  }
}

export async function isBackgroundSyncSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    return 'sync' in registration;
  } catch {
    return false;
  }
}

export function onServiceWorkerMessage(
  callback: (event: MessageEvent) => void,
): () => void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  navigator.serviceWorker.addEventListener('message', callback);
  return () => navigator.serviceWorker.removeEventListener('message', callback);
}
