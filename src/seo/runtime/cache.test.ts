import { describe, expect, it } from 'vitest';

import { ArtifactCache, DEFAULT_NEGATIVE_CACHE_MAX } from './cache';
import type { CachedEntry } from './etag';

function entry(body: string): CachedEntry {
  return {
    body,
    etag: '"e"',
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=300',
  };
}

describe('ArtifactCache', () => {
  it('round-trips entries', () => {
    const cache = new ArtifactCache();
    cache.set('llms-txt:static', entry('hello'));
    expect(cache.get('llms-txt:static')?.body).toBe('hello');
    expect(cache.get('missing')).toBeUndefined();
  });

  it('remembers misses', () => {
    const cache = new ArtifactCache();
    expect(cache.isKnownMiss('/foo.md')).toBe(false);
    cache.rememberMiss('/foo.md');
    expect(cache.isKnownMiss('/foo.md')).toBe(true);
  });

  it('clear() empties both stores', () => {
    const cache = new ArtifactCache();
    cache.set('k', entry('v'));
    cache.rememberMiss('/foo.md');
    cache.clear();
    expect(cache.get('k')).toBeUndefined();
    expect(cache.isKnownMiss('/foo.md')).toBe(false);
  });

  it('cap-and-clears the negative cache when full', () => {
    const cache = new ArtifactCache({ negativeMax: 3 });
    cache.rememberMiss('/a.md');
    cache.rememberMiss('/b.md');
    cache.rememberMiss('/c.md');
    expect(cache.isKnownMiss('/a.md')).toBe(true);

    cache.rememberMiss('/d.md');
    // Drop-everything eviction: the prior entries are gone.
    expect(cache.isKnownMiss('/a.md')).toBe(false);
    expect(cache.isKnownMiss('/d.md')).toBe(true);
  });

  it('defaults to a 1024-entry negative cache', () => {
    expect(DEFAULT_NEGATIVE_CACHE_MAX).toBe(1024);
  });
});
