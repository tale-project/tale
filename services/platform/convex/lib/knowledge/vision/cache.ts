'use node';

/**
 * Vision API result caching.
 *
 * Uses the SHA-256 hash of image bytes as the cache key with an in-memory LRU
 * cache (O(1) operations via a Map's insertion order). Separate caches for OCR
 * and image-description results with configurable sizes and hit/miss stats.
 *
 * The async `getOrSet*` methods use per-key locks so concurrent callers for the
 * *same* image coalesce into a single Vision API call while callers for
 * *different* images proceed without contention.
 */

import { createHash } from 'node:crypto';

export const OCR_CACHE_SIZE = 500;
export const DESCRIPTION_CACHE_SIZE = 1000;

export interface VisionCacheStats {
  ocr_hits: number;
  ocr_misses: number;
  description_hits: number;
  description_misses: number;
  ocr_cache_size: number;
  description_cache_size: number;
}

/** Compute the SHA-256 hash of image bytes for use as a cache key. */
export function computeImageHash(imageBytes: Uint8Array): string {
  return createHash('sha256').update(imageBytes).digest('hex');
}

/** A pending promise plus its resolvers, used as a per-key coalescing lock. */
interface KeyLock {
  promise: Promise<void>;
  release: () => void;
  waiters: number;
}

export class VisionCache {
  private readonly ocrCache = new Map<string, string>();
  private readonly descriptionCache = new Map<string, string>();
  private readonly ocrMax: number;
  private readonly descMax: number;
  private readonly stats = {
    ocr_hits: 0,
    ocr_misses: 0,
    description_hits: 0,
    description_misses: 0,
  };
  private readonly ocrKeyLocks = new Map<string, KeyLock>();
  private readonly descriptionKeyLocks = new Map<string, KeyLock>();

  constructor(
    ocrCacheSize: number = OCR_CACHE_SIZE,
    descriptionCacheSize: number = DESCRIPTION_CACHE_SIZE,
  ) {
    this.ocrMax = ocrCacheSize;
    this.descMax = descriptionCacheSize;
  }

  private evictIfNeeded(cache: Map<string, string>, maxSize: number): void {
    while (cache.size >= maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }
  }

  private touch(cache: Map<string, string>, key: string): string {
    const value = cache.get(key);
    if (value === undefined) {
      throw new Error('VisionCache.touch called for a missing key');
    }
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  getOcr(imageBytes: Uint8Array): [string | null, string] {
    const imageHash = computeImageHash(imageBytes);
    if (this.ocrCache.has(imageHash)) {
      this.stats.ocr_hits += 1;
      return [this.touch(this.ocrCache, imageHash), imageHash];
    }
    this.stats.ocr_misses += 1;
    return [null, imageHash];
  }

  setOcr(imageHash: string, result: string): void {
    this.evictIfNeeded(this.ocrCache, this.ocrMax);
    this.ocrCache.delete(imageHash);
    this.ocrCache.set(imageHash, result);
  }

  getDescription(imageBytes: Uint8Array): [string | null, string] {
    const imageHash = computeImageHash(imageBytes);
    if (this.descriptionCache.has(imageHash)) {
      this.stats.description_hits += 1;
      return [this.touch(this.descriptionCache, imageHash), imageHash];
    }
    this.stats.description_misses += 1;
    return [null, imageHash];
  }

  setDescription(imageHash: string, result: string): void {
    this.evictIfNeeded(this.descriptionCache, this.descMax);
    this.descriptionCache.delete(imageHash);
    this.descriptionCache.set(imageHash, result);
  }

  private async withKeyLock<T>(
    key: string,
    locks: Map<string, KeyLock>,
    fn: () => Promise<T>,
  ): Promise<T> {
    let lock = locks.get(key);
    while (lock) {
      lock.waiters += 1;
      await lock.promise;
      lock.waiters -= 1;
      lock = locks.get(key);
    }

    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const myLock: KeyLock = { promise, release, waiters: 0 };
    locks.set(key, myLock);

    try {
      return await fn();
    } finally {
      locks.delete(key);
      myLock.release();
    }
  }

  async getOrSetOcr(
    imageBytes: Uint8Array,
    fetchFn: () => Promise<string>,
  ): Promise<string> {
    const imageHash = computeImageHash(imageBytes);

    if (this.ocrCache.has(imageHash)) {
      this.stats.ocr_hits += 1;
      return this.touch(this.ocrCache, imageHash);
    }

    return this.withKeyLock(imageHash, this.ocrKeyLocks, async () => {
      if (this.ocrCache.has(imageHash)) {
        this.stats.ocr_hits += 1;
        return this.touch(this.ocrCache, imageHash);
      }
      this.stats.ocr_misses += 1;
      const result = await fetchFn();
      this.setOcr(imageHash, result);
      return result;
    });
  }

  async getOrSetDescription(
    imageBytes: Uint8Array,
    fetchFn: () => Promise<string>,
  ): Promise<string> {
    const imageHash = computeImageHash(imageBytes);

    if (this.descriptionCache.has(imageHash)) {
      this.stats.description_hits += 1;
      return this.touch(this.descriptionCache, imageHash);
    }

    return this.withKeyLock(imageHash, this.descriptionKeyLocks, async () => {
      if (this.descriptionCache.has(imageHash)) {
        this.stats.description_hits += 1;
        return this.touch(this.descriptionCache, imageHash);
      }
      this.stats.description_misses += 1;
      const result = await fetchFn();
      this.setDescription(imageHash, result);
      return result;
    });
  }

  getStats(): VisionCacheStats {
    return {
      ...this.stats,
      ocr_cache_size: this.ocrCache.size,
      description_cache_size: this.descriptionCache.size,
    };
  }

  /** Test/introspection helpers — expose internal map state read-only. */
  hasOcr(hash: string): boolean {
    return this.ocrCache.has(hash);
  }

  peekOcr(hash: string): string | undefined {
    return this.ocrCache.get(hash);
  }

  pendingOcrLocks(): number {
    return this.ocrKeyLocks.size;
  }

  clear(): void {
    this.ocrCache.clear();
    this.descriptionCache.clear();
  }
}
