'use node';

/**
 * HTTP client for the RAG service's LLM response semantic cache.
 *
 * Calls /api/v1/llm-cache/lookup and /api/v1/llm-cache/store endpoints.
 * Gracefully degrades if the RAG service is unavailable.
 */

import { getRagConfig } from '../helpers/rag_config';

const TIMEOUT_MS = 10_000;

export interface SemanticCacheHit {
  responseText: string;
  provider: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  similarity: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

export async function lookupSemanticCache(params: {
  agentName: string;
  model: string;
  userMessage: string;
  similarityThreshold?: number;
}): Promise<SemanticCacheHit | null> {
  try {
    const { serviceUrl } = getRagConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${serviceUrl}/api/v1/llm-cache/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: params.agentName,
        model: params.model,
        user_message: params.userMessage,
        similarity_threshold:
          params.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const raw: unknown = await response.json();
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('hit' in raw) ||
      !(raw as { hit: unknown }).hit
    )
      return null;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape validated by type guards above
    const data = raw as {
      hit: boolean;
      response_text?: string;
      provider?: string;
      usage?: Record<string, number>;
      similarity?: number;
    };
    if (!data.response_text) return null;

    return {
      responseText: data.response_text,
      provider: data.provider ?? null,
      usage: data.usage
        ? {
            inputTokens: data.usage.inputTokens ?? data.usage.input_tokens,
            outputTokens: data.usage.outputTokens ?? data.usage.output_tokens,
            totalTokens: data.usage.totalTokens ?? data.usage.total_tokens,
          }
        : null,
      similarity: data.similarity ?? 0,
    };
  } catch {
    // Graceful degradation: RAG service unavailable
    return null;
  }
}

export async function storeSemanticCache(params: {
  agentName: string;
  model: string;
  userMessage: string;
  responseText: string;
  provider?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  ttlHours?: number;
  userId?: string;
  organizationId?: string;
}): Promise<void> {
  try {
    const { serviceUrl } = getRagConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    await fetch(`${serviceUrl}/api/v1/llm-cache/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: params.agentName,
        model: params.model,
        user_message: params.userMessage,
        response_text: params.responseText,
        provider: params.provider,
        usage: params.usage,
        ttl_hours: params.ttlHours,
        user_id: params.userId,
        organization_id: params.organizationId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Fire-and-forget: don't fail the response if cache store fails
  }
}
