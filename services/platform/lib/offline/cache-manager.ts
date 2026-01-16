import { db } from './db';
import { DEFAULT_CACHE_CONFIG, type CacheConfig } from './types';

export function createCacheKey(
  queryName: string,
  organizationId: string,
  additionalParams?: Record<string, unknown>
): string {
  const base = `${queryName}:${organizationId}`;
  if (!additionalParams) return base;
  return `${base}:${JSON.stringify(additionalParams)}`;
}

export async function getQueryCache<T>(key: string): Promise<T[] | null> {
  const entry = await db.queryCache.get(key);
  if (!entry) return null;

  const isExpired = Date.now() - entry.timestamp > DEFAULT_CACHE_CONFIG.maxAge;
  if (isExpired) {
    await db.queryCache.delete(key);
    return null;
  }

  return entry.data as T[];
}

export async function setQueryCache<T>(
  key: string,
  data: T[],
  organizationId: string
): Promise<void> {
  await db.queryCache.put({
    key,
    data,
    timestamp: Date.now(),
    organizationId,
  });

  await db.syncMeta.put({
    key,
    lastSyncTimestamp: Date.now(),
    status: 'synced',
  });

  await enforceMaxEntries(organizationId);
}

export async function invalidateCache(pattern: string): Promise<number> {
  const allKeys = await db.queryCache.toCollection().primaryKeys();
  const matchingKeys = allKeys.filter((key) => key.includes(pattern));
  await db.queryCache.bulkDelete(matchingKeys);
  return matchingKeys.length;
}

export async function invalidateOrganizationCache(
  organizationId: string
): Promise<number> {
  const count = await db.queryCache
    .where('organizationId')
    .equals(organizationId)
    .count();

  await db.queryCache
    .where('organizationId')
    .equals(organizationId)
    .delete();

  return count;
}

export async function getCacheAge(key: string): Promise<number | null> {
  const entry = await db.queryCache.get(key);
  if (!entry) return null;
  return Date.now() - entry.timestamp;
}

export async function isCacheStale(
  key: string,
  maxAge: number = DEFAULT_CACHE_CONFIG.maxAge
): Promise<boolean> {
  const age = await getCacheAge(key);
  if (age === null) return true;
  return age > maxAge;
}

export async function getCacheStats(organizationId?: string): Promise<{
  totalEntries: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}> {
  let query = db.queryCache.toCollection();
  if (organizationId) {
    query = db.queryCache.where('organizationId').equals(organizationId);
  }

  const entries = await query.toArray();
  if (entries.length === 0) {
    return { totalEntries: 0, oldestEntry: null, newestEntry: null };
  }

  const timestamps = entries.map((e) => e.timestamp);
  return {
    totalEntries: entries.length,
    oldestEntry: Math.min(...timestamps),
    newestEntry: Math.max(...timestamps),
  };
}

async function enforceMaxEntries(
  organizationId: string,
  config: CacheConfig = DEFAULT_CACHE_CONFIG
): Promise<void> {
  const entries = await db.queryCache
    .where('organizationId')
    .equals(organizationId)
    .sortBy('timestamp');

  if (entries.length > config.maxEntries) {
    const toDelete = entries
      .slice(0, entries.length - config.maxEntries)
      .map((e) => e.key);
    await db.queryCache.bulkDelete(toDelete);
  }
}

export async function updateCacheItem<T>(
  key: string,
  updater: (data: T[]) => T[]
): Promise<boolean> {
  const entry = await db.queryCache.get(key);
  if (!entry) return false;

  const updatedData = updater(entry.data as T[]);
  await db.queryCache.update(key, {
    data: updatedData,
    timestamp: entry.timestamp,
  });

  return true;
}

export async function appendToCacheItem<T>(
  key: string,
  item: T
): Promise<boolean> {
  return updateCacheItem<T>(key, (data) => [...data, item]);
}

export async function removeCacheItemById<T extends { _id: string }>(
  key: string,
  id: string
): Promise<boolean> {
  return updateCacheItem<T>(key, (data) =>
    data.filter((item) => item._id !== id)
  );
}

export async function updateCacheItemById<T extends { _id: string }>(
  key: string,
  id: string,
  updates: Partial<T>
): Promise<boolean> {
  return updateCacheItem<T>(key, (data) =>
    data.map((item) => (item._id === id ? { ...item, ...updates } : item))
  );
}
