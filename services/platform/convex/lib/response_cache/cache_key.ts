import type { GenerationParams } from '../agent_chat/types';
import { normalizeForCache } from './normalize';

const CACHE_VERSION = 'v1';

/**
 * Simple FNV-1a hash for cache key generation.
 * Not cryptographic — only needs collision resistance for cache deduplication.
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to unsigned 32-bit hex + append length-based suffix for extra uniqueness
  const h1 = (hash >>> 0).toString(16).padStart(8, '0');

  // Second pass with different seed for 64-bit equivalent
  let hash2 = 0x6c62272e;
  for (let i = str.length - 1; i >= 0; i--) {
    hash2 ^= str.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');

  return `${h1}${h2}`;
}

/**
 * Compute a cache key from stable inputs.
 *
 * Uses raw `instructions` (before template variable resolution) and
 * `threadContext` (conversation history, RAG, web) separately, so that
 * time-varying variables like {{current_time}} don't bust the cache.
 *
 * `userPersonalizationFingerprint` partitions the cache when a user-specific
 * block (custom instructions, memories) is folded into the system prompt
 * outside of the `instructions` parameter. Pass `''` (or omit) when no such
 * block is injected — behavior then matches the prior signature.
 */
export function computeCacheKey(params: {
  agentName: string;
  model: string;
  instructions: string;
  threadContext: string;
  userMessage: string;
  generationParams?: GenerationParams;
  userPersonalizationFingerprint?: string;
}): string {
  const base: Record<string, unknown> = {
    v: CACHE_VERSION,
    agent: params.agentName,
    model: params.model,
    instructions: normalizeForCache(params.instructions),
    context: normalizeForCache(params.threadContext),
    user: normalizeForCache(params.userMessage),
    params: params.generationParams ?? {},
  };
  // Only fold the fingerprint in when it is non-empty, so callers that
  // omit it (or pass '') produce keys byte-identical to the prior signature
  // — preserves existing cache entries during the rollout.
  if (params.userPersonalizationFingerprint) {
    base.pf = params.userPersonalizationFingerprint;
  }
  return fnv1aHash(JSON.stringify(base));
}
