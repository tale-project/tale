import { useEffect, useState, useSyncExternalStore } from 'react';

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

export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useOnlineStatusWithCallback(
  onOnline?: () => void,
  onOffline?: () => void
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
