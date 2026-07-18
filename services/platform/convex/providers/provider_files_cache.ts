'use node';

/**
 * In-process cache for the per-turn provider catalog built by
 * `loadAllProviders` in ./file_actions.ts.
 *
 * Rebuilding the catalog every send is pure overhead on the chat hot path: it
 * re-reads + Zod-parses EVERY provider JSON and decrypts every secrets file
 * per model resolution, for data that only changes when an operator edits a
 * provider. The catalog is a pure function of the provider directory's on-disk
 * content, so it can be cached and reused across turns.
 *
 * Mirrors the proven module-level cache in `../lib/agent_chat/skill_context_cache.ts`
 * (itself modelled on `lib/sops.ts`): a `Map` keyed by directory, validated
 * with a cheap `readdir` + `stat` fingerprint on every read — so ANY write to
 * a provider file (app save actions, operator edits, scaffolds) shifts the
 * fingerprint and misses naturally; no explicit invalidation hook is needed.
 * The self-hosted Node executor is a single persistent process, so
 * module-level state persists across invocations and is cleared on
 * deploy/restart.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

interface CacheEntry {
  fingerprint: string;
  value: unknown[];
}

const cache = new Map<string, CacheEntry>();

/**
 * Cheap freshness probe: list the provider directory and combine every
 * `*.json` entry's (name, mtime, size) — this covers both `<provider>.json`
 * and `<provider>.secrets.json`, so config edits AND key rotations shift the
 * fingerprint. Returns `null` when the directory is unreadable so the caller
 * falls through to the uncached path (which owns the friendly error).
 */
export async function computeProvidersFingerprint(
  dir: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const relevant = entries.filter((e) => e.endsWith('.json')).sort();
  const parts = await Promise.all(
    relevant.map(async (name) => {
      try {
        const s = await stat(path.join(dir, name));
        return `${name}:${s.mtimeMs}:${s.size}`;
      } catch {
        return `${name}:absent`;
      }
    }),
  );
  return parts.join('|');
}

/** Return the cached catalog iff present AND its fingerprint still matches.
 *  The array is shallow-copied so callers reordering it can't corrupt the
 *  cache; entries themselves are treated as immutable by all callers. */
export function getCachedProviders<T>(
  dir: string,
  fingerprint: string,
): T[] | undefined {
  const entry = cache.get(dir);
  if (entry && entry.fingerprint === fingerprint) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- single writer (setCachedProviders) stores the caller's own element type
    return [...entry.value] as T[];
  }
  return undefined;
}

export function setCachedProviders(
  dir: string,
  fingerprint: string,
  value: unknown[],
): void {
  cache.set(dir, { fingerprint, value: [...value] });
}

/** Test hook: drop everything (mirrors the skill-context cache's helper). */
export function clearProviderFilesCacheForTest(): void {
  cache.clear();
}
