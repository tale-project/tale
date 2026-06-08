'use node';

/**
 * In-process cache for the per-turn skill snapshot built by
 * `buildSkillContext` in ./skills_runtime.ts.
 *
 * Rebuilding the snapshot every send is expensive: it makes nested
 * `ctx.runAction` calls into the `skills/file_actions` node actions (each a
 * full HTTP round-trip back to the backend) plus disk reads of every bound
 * skill's SKILL.md + bundle. The snapshot is a pure function of the bound
 * skills' on-disk content, so it can be cached and reused across turns.
 *
 * Mirrors the proven module-level cache in `lib/sops.ts`: a `Map` keyed by
 * content identity, validated with a cheap `stat` (mtime) on read, plus an
 * explicit `invalidate*` hook called by the writing actions. The self-hosted
 * Node executor is a single persistent process, so module-level state persists
 * across invocations and is cleared on deploy/restart (new source package) —
 * which is exactly when on-disk skills change wholesale.
 */

import { stat } from 'node:fs/promises';

import { resolveSkillMdPath } from '../../skills/file_utils';
import type { SkillSnapshot } from './skills_runtime';

interface CacheEntry {
  snapshot: SkillSnapshot;
  /** Freshness fingerprint: each bound slug's SKILL.md mtime (or "absent"). */
  mtimeKey: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * Stable cache key for an (org, bound-skill-set) pair. Org and skill slugs are
 * `[a-z0-9-]`-only, so `::`/`,` separators cannot collide across distinct sets.
 */
function cacheKey(orgSlug: string, boundSlugs: readonly string[]): string {
  return `${orgSlug}::${[...boundSlugs].sort().join(',')}`;
}

/**
 * Cheap freshness probe: `stat` each bound slug's SKILL.md and combine their
 * mtimes. A change to any bound skill (edit, add, remove) shifts the key, so a
 * stale entry misses and rebuilds. Runs in-process (this is a `'use node'`
 * module) — no `runAction` round-trip. Missing files resolve to "absent" so
 * adding/removing a skill also shifts the key.
 */
export async function computeSkillMtimeKey(
  orgSlug: string,
  boundSlugs: readonly string[],
): Promise<string> {
  const sorted = [...boundSlugs].sort();
  const parts = await Promise.all(
    sorted.map(async (slug) => {
      try {
        const s = await stat(resolveSkillMdPath(orgSlug, slug));
        return `${slug}:${s.mtimeMs}`;
      } catch {
        return `${slug}:absent`;
      }
    }),
  );
  return parts.join('|');
}

/** Return the cached snapshot iff present AND its freshness key still matches. */
export function getCachedSkillSnapshot(
  orgSlug: string,
  boundSlugs: readonly string[],
  mtimeKey: string,
): SkillSnapshot | undefined {
  const entry = cache.get(cacheKey(orgSlug, boundSlugs));
  if (entry && entry.mtimeKey === mtimeKey) return entry.snapshot;
  return undefined;
}

export function setCachedSkillSnapshot(
  orgSlug: string,
  boundSlugs: readonly string[],
  mtimeKey: string,
  snapshot: SkillSnapshot,
): void {
  cache.set(cacheKey(orgSlug, boundSlugs), { snapshot, mtimeKey });
}

/**
 * Drop every cached snapshot for an org. Called by the skill-writing actions
 * (`uploadSkillBundle`, `deleteSkill`) after they mutate disk, so a change is
 * reflected immediately rather than waiting on the mtime probe. Over-broad on
 * purpose (clears the whole org, not just the changed slug) — skill writes are
 * rare and a rebuild on the next send is cheap.
 */
export function invalidateSkillContextCache(orgSlug: string): void {
  const prefix = `${orgSlug}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
