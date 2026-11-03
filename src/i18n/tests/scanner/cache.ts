/**
 * Per-run cache for parsed + masked sources.
 *
 * 27 checks each pull the fragments for every applicable source. Re-reading
 * + re-parsing + re-masking each file 27× is wasted work. The cache keys
 * parsed sources by absolute path and holds them for the vitest run.
 *
 * Cache lifetime: the process. vitest runs each suite in one process; the
 * cache is reset only when the framework is freshly imported.
 */

import type { Fragment, Source } from './types';

const cache = new Map<string, Fragment[]>();

export function getCached(source: Source): Fragment[] | undefined {
  return cache.get(source.path);
}

export function setCached(source: Source, fragments: Fragment[]): void {
  cache.set(source.path, fragments);
}
