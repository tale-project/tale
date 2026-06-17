import { describe, expect, it } from 'vitest';

import { VisionCache } from './cache';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('VisionCache (sync)', () => {
  it('reports an OCR miss with a SHA-256 hash', () => {
    const cache = new VisionCache();
    const [result, imageHash] = cache.getOcr(enc('test-image'));
    expect(result).toBeNull();
    expect(imageHash).toHaveLength(64);
  });

  it('returns a cached OCR result on hit', () => {
    const cache = new VisionCache();
    const [, imageHash] = cache.getOcr(enc('test-image'));
    cache.setOcr(imageHash, 'extracted text');
    expect(cache.getOcr(enc('test-image'))[0]).toBe('extracted text');
  });

  it('reports a description miss', () => {
    const cache = new VisionCache();
    expect(cache.getDescription(enc('test-image'))[0]).toBeNull();
  });

  it('returns a cached description on hit', () => {
    const cache = new VisionCache();
    const [, imageHash] = cache.getDescription(enc('test-image'));
    cache.setDescription(imageHash, 'a photo of a cat');
    expect(cache.getDescription(enc('test-image'))[0]).toBe('a photo of a cat');
  });

  it('tracks hit/miss stats', () => {
    const cache = new VisionCache();
    const [, h] = cache.getOcr(enc('img1'));
    cache.setOcr(h, 'text');
    cache.getOcr(enc('img1'));
    const stats = cache.getStats();
    expect(stats.ocr_hits).toBe(1);
    expect(stats.ocr_misses).toBe(1);
  });

  it('evicts the least-recently-used entry past capacity', () => {
    const cache = new VisionCache(2);
    cache.setOcr('hash1', 'text1');
    cache.setOcr('hash2', 'text2');
    cache.setOcr('hash3', 'text3');
    expect(cache.peekOcr('hash1')).toBeUndefined();
    expect(cache.peekOcr('hash2')).toBe('text2');
    expect(cache.peekOcr('hash3')).toBe('text3');
  });

  it('clears all caches', () => {
    const cache = new VisionCache();
    const [, h] = cache.getOcr(enc('img'));
    cache.setOcr(h, 'text');
    cache.clear();
    const stats = cache.getStats();
    expect(stats.ocr_cache_size).toBe(0);
    expect(stats.description_cache_size).toBe(0);
  });
});

describe('VisionCache (async)', () => {
  it('calls fetch on miss', async () => {
    const cache = new VisionCache();
    let calls = 0;
    const result = await cache.getOrSetOcr(enc('image-data'), async () => {
      calls += 1;
      return 'ocr result';
    });
    expect(result).toBe('ocr result');
    expect(calls).toBe(1);
    expect(cache.getStats().ocr_misses).toBe(1);
  });

  it('skips fetch on hit', async () => {
    const cache = new VisionCache();
    cache.setOcr(
      'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
      'cached ocr',
    );
    const result = await cache.getOrSetOcr(enc('123'), () => {
      throw new Error('fetch should not run on hit');
    });
    expect(result).toBe('cached ocr');
    const stats = cache.getStats();
    expect(stats.ocr_hits).toBe(1);
    expect(stats.ocr_misses).toBe(0);
  });

  it('coalesces concurrent OCR calls into a single fetch', async () => {
    const cache = new VisionCache();
    let calls = 0;
    const slowFetch = async (): Promise<string> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      return 'fetched once';
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        cache.getOrSetOcr(enc('same-image'), slowFetch),
      ),
    );
    expect(results.every((r) => r === 'fetched once')).toBe(true);
    expect(calls).toBe(1);
    const stats = cache.getStats();
    expect(stats.ocr_misses).toBe(1);
    expect(stats.ocr_hits).toBe(4);
  });

  it('does not contend across different keys', async () => {
    const cache = new VisionCache();
    let calls = 0;
    const fetchFn = async (): Promise<string> => {
      calls += 1;
      const id = calls;
      await new Promise((r) => setTimeout(r, 10));
      return `result-${id}`;
    };
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        cache.getOrSetOcr(enc(`image-${i}`), fetchFn),
      ),
    );
    expect(calls).toBe(3);
    expect(new Set(results).size).toBe(3);
  });

  it('cleans up the per-key lock after use', async () => {
    const cache = new VisionCache();
    await cache.getOrSetOcr(enc('img'), async () => 'result');
    expect(cache.pendingOcrLocks()).toBe(0);
  });

  it('does not cache on fetch error', async () => {
    const cache = new VisionCache();
    await expect(
      cache.getOrSetOcr(enc('bad-image'), async () => {
        throw new Error('API error');
      }),
    ).rejects.toThrow('API error');
    const stats = cache.getStats();
    expect(stats.ocr_cache_size).toBe(0);
    expect(stats.ocr_misses).toBe(1);
  });

  it('releases the lock after a fetch error so a retry can succeed', async () => {
    const cache = new VisionCache();
    let calls = 0;
    const failingThenOk = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) {
        throw new Error('transient error');
      }
      return 'recovered';
    };
    await expect(
      cache.getOrSetOcr(enc('retry-image'), failingThenOk),
    ).rejects.toThrow();
    const result = await cache.getOrSetOcr(enc('retry-image'), failingThenOk);
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });
});
