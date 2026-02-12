import { useEffect, useState, useSyncExternalStore } from 'react';

import { useConvexConnectionState } from '@/app/hooks/use-convex-connection-state';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

function useBrowserOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useOnlineStatus() {
  const browserOnline = useBrowserOnlineStatus();
  const convexState = useConvexConnectionState();

  return browserOnline || convexState.isWebSocketConnected;
}

export function useOnlineStatusWithCallback(
  onOnline?: () => void,
  onOffline?: () => void,
) {
  const isOnline = useOnlineStatus();
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (isOnline && wasOffline) {
      onOnline?.();
      setWasOffline(false);
    } else if (!isOnline && !wasOffline) {
      onOffline?.();
      setWasOffline(true);
    }
  }, [isOnline, wasOffline, onOnline, onOffline]);

  return isOnline;
}
