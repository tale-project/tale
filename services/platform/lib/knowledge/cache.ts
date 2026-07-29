/**
 * The semantic-cache seam — OFF by default.
 *
 * Repeated near-identical questions are common, and answering them from a
 * previous search saves an embedding call and two index scans. The catch is
 * that a cache turns "similar enough" into a correctness decision: too loose a
 * threshold and a caller gets the answer to a question they did not ask, and
 * every entry is tenant data that must never be read by another organization.
 *
 * That is why this is a seam and not a feature. Nothing is cached unless a
 * deployment installs an implementation, and an implementation is handed the
 * organization on every call — a cache keyed only by the query text would
 * silently share one tenant's retrieved content with the next tenant that asks
 * the same question, which is the single worst failure this subsystem can have.
 *
 * A cache is also never allowed to change what a correct answer looks like:
 * retrieval only consults it for unfiltered searches (no folder, no document
 * restriction), because a cached answer cannot know which filter produced it.
 * A cache failure is logged and ignored, never surfaced as a search failure.
 */

import type { FusedKnowledgeHit } from './types';

export interface CacheKey {
  /** The organization the search ran for. Every implementation MUST scope
   * both reads and writes by it. */
  readonly orgSlug: string;
  readonly query: string;
  /** The query embedding, for implementations that match by similarity rather
   * than by exact text. */
  readonly embedding: readonly number[];
  /** Which corpus was searched — the same words against a different corpus is
   * a different question. */
  readonly corpus: string;
}

/**
 * What retrieval needs from a cache.
 *
 * `lookup` returns `null` for a miss. `store` is best-effort; retrieval does
 * not await its failure path beyond logging it.
 */
export interface KnowledgeCache {
  readonly name: string;
  lookup(key: CacheKey): Promise<readonly FusedKnowledgeHit[] | null>;
  store(key: CacheKey, hits: readonly FusedKnowledgeHit[]): Promise<void>;
}

let installed: KnowledgeCache | null = null;

/** Install a semantic cache for this process. */
export function setKnowledgeCache(cache: KnowledgeCache | null): void {
  installed = cache;
}

/** The installed cache, or `null` — the default, which means every search is
 * answered from the corpus. */
export function knowledgeCache(): KnowledgeCache | null {
  return installed;
}
