import Dexie, { type EntityTable } from 'dexie';
import type { CachedQueryEntry, QueuedMutation, SyncMetaEntry } from './types';

class OfflineDatabase extends Dexie {
  queryCache!: EntityTable<CachedQueryEntry, 'key'>;
  mutationQueue!: EntityTable<QueuedMutation, 'id'>;
  syncMeta!: EntityTable<SyncMetaEntry, 'key'>;

  constructor() {
    super('TaleOfflineDB');

    this.version(1).stores({
      queryCache: 'key, organizationId, timestamp',
      mutationQueue: 'id, status, timestamp',
      syncMeta: 'key, status',
    });
  }
}

export const db = new OfflineDatabase();

export async function clearAllOfflineData(): Promise<void> {
  await Promise.all([
    db.queryCache.clear(),
    db.mutationQueue.clear(),
    db.syncMeta.clear(),
  ]);
}

export async function clearOrganizationData(
  organizationId: string
): Promise<void> {
  await db.queryCache.where('organizationId').equals(organizationId).delete();
}

export async function getOfflineStorageSize(): Promise<{
  queryCache: number;
  mutationQueue: number;
  syncMeta: number;
  total: number;
}> {
  const [queryCacheCount, mutationQueueCount, syncMetaCount] =
    await Promise.all([
      db.queryCache.count(),
      db.mutationQueue.count(),
      db.syncMeta.count(),
    ]);

  return {
    queryCache: queryCacheCount,
    mutationQueue: mutationQueueCount,
    syncMeta: syncMetaCount,
    total: queryCacheCount + mutationQueueCount + syncMetaCount,
  };
}
