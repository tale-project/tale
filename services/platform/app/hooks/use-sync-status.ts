import { useSyncExternalStore, useCallback, useMemo } from 'react';
import { useConvex } from 'convex/react';
import {
  subscribeSyncState,
  getSyncState,
  forceSyncNow,
  type OfflineState,
} from '@/lib/offline';

function getSnapshot(): OfflineState {
  return getSyncState();
}

function getServerSnapshot(): OfflineState {
  return {
    isOnline: true,
    pendingMutations: 0,
    failedMutations: 0,
    lastSyncAttempt: null,
    lastSuccessfulSync: null,
    isSyncing: false,
  };
}

export function useSyncStatus() {
  const convex = useConvex();

  const state = useSyncExternalStore(
    subscribeSyncState,
    getSnapshot,
    getServerSnapshot
  );

  const syncNow = useCallback(async () => {
    return forceSyncNow(convex);
  }, [convex]);

  return useMemo(
    () => ({
      isOnline: state.isOnline,
      isOffline: !state.isOnline,
      isSyncing: state.isSyncing,
      pendingMutations: state.pendingMutations,
      failedMutations: state.failedMutations,
      lastSyncAttempt: state.lastSyncAttempt,
      lastSuccessfulSync: state.lastSuccessfulSync,
      hasPendingChanges: state.pendingMutations > 0 || state.failedMutations > 0,
      syncNow,
    }),
    [state, syncNow],
  );
}
