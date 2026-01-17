import { useSyncExternalStore, useCallback } from 'react';
import {
  subscribeToQueueChanges,
  getQueueStats,
  getPendingMutations,
  getFailedMutations,
  retryFailedMutation,
  retryAllFailedMutations,
  clearAllMutations,
} from '@/lib/offline';
import type { QueuedMutation } from '@/lib/offline';

interface MutationQueueState {
  pendingCount: number;
  failedCount: number;
}

let cachedState: MutationQueueState = {
  pendingCount: 0,
  failedCount: 0,
};

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);

  const unsubscribe = subscribeToQueueChanges((stats) => {
    cachedState = {
      pendingCount: stats.pending,
      failedCount: stats.failed,
    };
    notifyListeners();
  });

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      unsubscribe();
    }
  };
}

function getSnapshot(): MutationQueueState {
  return cachedState;
}

function getServerSnapshot(): MutationQueueState {
  return { pendingCount: 0, failedCount: 0 };
}

export function useMutationQueue() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const refreshStats = useCallback(async () => {
    const stats = await getQueueStats();
    cachedState = {
      pendingCount: stats.pending,
      failedCount: stats.failed,
    };
    notifyListeners();
  }, []);

  const getPending = useCallback(async (): Promise<QueuedMutation[]> => {
    return getPendingMutations();
  }, []);

  const getFailed = useCallback(async (): Promise<QueuedMutation[]> => {
    return getFailedMutations();
  }, []);

  const retry = useCallback(async (id: string): Promise<void> => {
    await retryFailedMutation(id);
  }, []);

  const retryAll = useCallback(async (): Promise<number> => {
    return retryAllFailedMutations();
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    await clearAllMutations();
    await refreshStats();
  }, [refreshStats]);

  return {
    pendingCount: state.pendingCount,
    failedCount: state.failedCount,
    hasPending: state.pendingCount > 0,
    hasFailed: state.failedCount > 0,
    getPending,
    getFailed,
    retry,
    retryAll,
    clearAll,
    refreshStats,
  };
}
