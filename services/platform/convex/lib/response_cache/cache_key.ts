import type { GenerationParams } from '../agent_chat/types';
import { fnv1aHash } from '../fnv1a';
import { normalizeForCache } from './normalize';

const CACHE_VERSION = 'v1';

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
