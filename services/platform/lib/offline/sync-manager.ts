import type { ConvexReactClient } from 'convex/react';
import type { FunctionReference } from 'convex/server';
import { db } from './db';
import {
  getPendingMutations,
  updateMutationStatus,
  incrementRetryCount,
  removeMutation,
} from './mutation-queue';
import type { QueuedMutation, OfflineState } from './types';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000];

type SyncListener = (state: OfflineState) => void;
const listeners = new Set<SyncListener>();

let syncState: OfflineState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingMutations: 0,
  failedMutations: 0,
  lastSyncAttempt: null,
  lastSuccessfulSync: null,
  isSyncing: false,
};

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(syncState);
  }
}

function updateSyncState(updates: Partial<OfflineState>): void {
  syncState = { ...syncState, ...updates };
  notifyListeners();
}

export function getSyncState(): OfflineState {
  return syncState;
}

export function subscribeSyncState(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(syncState);
  return () => listeners.delete(listener);
}

export async function processMutationQueue(
  convex: ConvexReactClient
): Promise<{ processed: number; failed: number }> {
  if (syncState.isSyncing) {
    return { processed: 0, failed: 0 };
  }

  updateSyncState({ isSyncing: true, lastSyncAttempt: new Date() });

  const mutations = await getPendingMutations();
  let processed = 0;
  let failed = 0;

  for (const mutation of mutations) {
    try {
      await updateMutationStatus(mutation.id, 'processing');

      await executeMutation(convex, mutation);

      await removeMutation(mutation.id);
      processed++;
    } catch (error) {
      const retryCount = await incrementRetryCount(mutation.id);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (retryCount >= MAX_RETRIES) {
        await updateMutationStatus(mutation.id, 'failed', errorMessage);
        failed++;
      } else {
        await updateMutationStatus(mutation.id, 'pending', errorMessage);
        await delay(RETRY_DELAYS[retryCount - 1] ?? 1000);
      }
    }
  }

  const stats = await getQueueStats();
  updateSyncState({
    isSyncing: false,
    pendingMutations: stats.pending,
    failedMutations: stats.failed,
    lastSuccessfulSync: failed === 0 ? new Date() : syncState.lastSuccessfulSync,
  });

  return { processed, failed };
}

async function executeMutation(
  convex: ConvexReactClient,
  mutation: QueuedMutation
): Promise<unknown> {
  const mutationRef = mutation.mutationFn as unknown as FunctionReference<
    'mutation',
    'public'
  >;

  return convex.mutation(mutationRef, mutation.args);
}

async function getQueueStats(): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([
    db.mutationQueue.where('status').equals('pending').count(),
    db.mutationQueue.where('status').equals('failed').count(),
  ]);
  return { pending, failed };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function initSyncManager(convex: ConvexReactClient): () => void {
  const handleOnline = () => {
    updateSyncState({ isOnline: true });
    processMutationQueue(convex);
  };

  const handleOffline = () => {
    updateSyncState({ isOnline: false });
  };

  const handleSyncMessage = (event: MessageEvent) => {
    if (event.data?.type === 'SYNC_MUTATIONS') {
      processMutationQueue(convex);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    navigator.serviceWorker?.addEventListener('message', handleSyncMessage);

    getQueueStats().then((stats) => {
      updateSyncState({
        pendingMutations: stats.pending,
        failedMutations: stats.failed,
      });
    });

    if (navigator.onLine) {
      processMutationQueue(convex);
    }
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      navigator.serviceWorker?.removeEventListener('message', handleSyncMessage);
    }
  };
}

export async function forceSyncNow(
  convex: ConvexReactClient
): Promise<{ processed: number; failed: number }> {
  if (!navigator.onLine) {
    return { processed: 0, failed: 0 };
  }
  return processMutationQueue(convex);
}
