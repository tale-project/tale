'use node';

/**
 * Failover-aware model resolution.
 *
 * Wraps the standard resolve functions with circuit-breaker checks and
 * a fallback chain: model fallback -> provider fallback -> first model with same tag.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';

import type { ActionCtx } from '../_generated/server';
import { isOpen } from './circuit_breaker';
import {
  resolveLanguageModel,
  resolveLanguageModelById,
  type ResolvedModelData,
} from './resolve_model';

const MAX_FAILOVER_ATTEMPTS = 3;

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

  // Attempt 1: primary model
  if (params.modelId) {
    const provider = params.providerName ?? '';
    if (!isOpen(provider, params.modelId)) {
      attempts.push({
        modelId: params.modelId,
        providerName: params.providerName,
      });
    }
  } else if (params.tag) {
    attempts.push({ tag: params.tag, providerName: params.providerName });
  }

  // Attempt 2: model-level fallback
  if (params.fallbackModelId) {
    attempts.push({
      modelId: params.fallbackModelId,
      providerName: params.fallbackProviderName ?? params.providerName,
    });
  }

  // Attempt 3: provider-level fallback (if different from model-level)
  if (
    params.fallbackProviderName &&
    params.fallbackModelId !== params.fallbackModelId
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
      continue;
    }
  }

  throw lastError ?? new Error('No model could be resolved after failover');
}
