'use node';

/**
 * Failover-aware model resolution.
 *
 * Wraps the standard resolve functions with circuit-breaker checks and
 * a fallback chain: model fallback -> provider fallback -> first model with same tag.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { ConvexError } from 'convex/values';

import type { ActionCtx } from '../_generated/server';
import { isOpen, recordFailure } from './circuit_breaker';
import {
  resolveLanguageModel,
  resolveLanguageModelById,
  type ResolvedModelData,
} from './resolve_model';

/**
 * Cap on attempts the loop will execute. Must match the documented
 * fallback-chain length below (currently 4) — `slice(0, MAX)` would
 * silently drop the broadest "any-provider tag search" safety net if
 * this is set lower than the chain length.
 */
const MAX_FAILOVER_ATTEMPTS = 4;

interface FailoverParams {
  modelId?: string;
  providerName?: string;
  tag?: string;
  fallbackModelId?: string;
  fallbackProviderName?: string;
  /**
   * Resolves providers from `/examples/{orgSlug}/providers/` so each org
   * uses its own API keys / models. Omit for system-level callers with no
   * org context — they fall back to the global default org.
   */
  orgSlug?: string;
}

interface ResolvedLanguageModel {
  languageModel: LanguageModelV3;
  modelData: ResolvedModelData;
}

/**
 * Resolve a language model with automatic failover when the circuit breaker
 * indicates the primary model is unavailable.
 *
 * Fallback chain (up to MAX_FAILOVER_ATTEMPTS total):
 * 1. Primary model (skip if circuit open)
 * 2. Model-level fallbackModelId
 * 3. Provider-level fallbackModelId / fallbackProviderName
 * 4. First available model with same tag
 */
export async function resolveLanguageModelWithFallback(
  ctx: ActionCtx,
  params: FailoverParams,
): Promise<ResolvedLanguageModel> {
  const attempts: Array<{
    modelId?: string;
    providerName?: string;
    tag?: string;
  }> = [];

  // Helper: skip an explicit `(provider, modelId)` attempt when its
  // circuit is open. Tag-only attempts can't be filtered up front
  // because the resolved model id is unknown until resolution; for
  // those we fall through and let the resolver pick a model — the
  // generation-side `recordFailure` callers (generate_response,
  // agent_chat, workflow LLM nodes) will track that tuple's failures.
  const pushIfClosed = (a: {
    modelId?: string;
    providerName?: string;
    tag?: string;
  }) => {
    if (a.modelId && isOpen(a.providerName ?? '', a.modelId)) return;
    attempts.push(a);
  };

  // Attempt 1: primary model
  if (params.modelId) {
    pushIfClosed({
      modelId: params.modelId,
      providerName: params.providerName,
    });
  } else if (params.tag) {
    attempts.push({ tag: params.tag, providerName: params.providerName });
  }

  // Attempt 2: model-level fallback
  if (params.fallbackModelId) {
    pushIfClosed({
      modelId: params.fallbackModelId,
      providerName: params.fallbackProviderName ?? params.providerName,
    });
  }

  // Attempt 3: tag-search in the fallback provider (only if it's a
  // different provider than the primary — otherwise we'd be re-searching
  // the same provider that the primary attempt already covered).
  if (
    params.fallbackProviderName &&
    params.fallbackProviderName !== params.providerName
  ) {
    attempts.push({
      tag: params.tag ?? 'chat',
      providerName: params.fallbackProviderName,
    });
  }

  // Attempt 4: any model with same tag (no provider restriction)
  if (params.tag) {
    attempts.push({ tag: params.tag });
  }

  // Deduplicate and limit attempts
  const seen = new Set<string>();
  const uniqueAttempts = attempts.filter((a) => {
    const key = `${a.modelId ?? ''}:${a.providerName ?? ''}:${a.tag ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const limitedAttempts = uniqueAttempts.slice(0, MAX_FAILOVER_ATTEMPTS);

  // Surface a structured "no attempts" error early so callers can
  // distinguish "you misconfigured failover" from "every attempt threw".
  if (limitedAttempts.length === 0) {
    throw new ConvexError({
      code: 'NO_FAILOVER_ATTEMPTS',
      message:
        'No model could be attempted: all candidates were filtered out (circuit open or no inputs).',
      hadModelId: !!params.modelId,
      hadTag: !!params.tag,
      hadFallbackModelId: !!params.fallbackModelId,
      hadFallbackProviderName: !!params.fallbackProviderName,
    });
  }

  let lastError: unknown;

  for (const attempt of limitedAttempts) {
    try {
      if (attempt.modelId) {
        return await resolveLanguageModelById(ctx, {
          modelId: attempt.modelId,
          providerName: attempt.providerName,
          orgSlug: params.orgSlug,
        });
      }
      if (attempt.tag) {
        return await resolveLanguageModel(ctx, {
          tag: attempt.tag,
          providerName: attempt.providerName,
          orgSlug: params.orgSlug,
        });
      }
    } catch (err) {
      lastError = err;
      // Resolution-side failure for an explicit (provider, modelId)
      // attempt counts toward the breaker — without this, attempts
      // 2-4 against a dead model never trip cooldown via this path
      // (only generation-side callers update state), and we'd keep
      // trying the same dead tuple every request.
      if (attempt.modelId) {
        recordFailure(attempt.providerName ?? '', attempt.modelId);
      }
      continue;
    }
  }

  throw lastError ?? new Error('No model could be resolved after failover');
}
