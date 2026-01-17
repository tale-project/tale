import type { FunctionReference } from 'convex/server';

export interface CachedQueryEntry {
  key: string;
  data: unknown[];
  timestamp: number;
  organizationId: string;
}

export interface QueuedMutation {
  id: string;
  mutationFn: string;
  args: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
  status: 'pending' | 'processing' | 'failed';
  error?: string;
  optimisticData?: unknown;
}

export interface SyncMetaEntry {
  key: string;
  lastSyncTimestamp: number;
  status: 'synced' | 'stale' | 'error';
}

export interface OfflineState {
  isOnline: boolean;
  pendingMutations: number;
  failedMutations: number;
  lastSyncAttempt: Date | null;
  lastSuccessfulSync: Date | null;
  isSyncing: boolean;
}

export interface UseOfflineEntityDataReturn<TItem> {
  data: TItem[];
  totalCount: number;
  filteredCount: number;
  isLoading: boolean;
  isOffline: boolean;
  isStale: boolean;
  lastSyncTime: Date | null;
}

export interface MutationQueueConfig<TArgs = Record<string, unknown>> {
  mutationFn: FunctionReference<'mutation', 'public'>;
  getOptimisticData?: (args: TArgs) => unknown;
  getCacheKey: (args: TArgs) => string;
}

export interface CacheConfig {
  maxAge: number;
  maxEntries: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxAge: 24 * 60 * 60 * 1000,
  maxEntries: 100,
};
