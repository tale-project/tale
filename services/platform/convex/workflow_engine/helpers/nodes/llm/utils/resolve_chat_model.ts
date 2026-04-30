import { ConvexError } from 'convex/values';

import { parseModelRef } from '../../../../../../lib/shared/utils/model-ref';
import type { ActionCtx } from '../../../../../_generated/server';
import { resolveLanguageModelWithFallback } from '../../../../../providers/failover';
import type { ResolvedModelData } from '../../../../../providers/resolve_model';
import type { LLMNodeConfig } from '../../../../types';

/**
 * Resolve the chat model for an LLM workflow step. Routes to the explicit
 * `config.model` ref when set, otherwise resolves the org's `defaults.chat`
 * tag. Both paths consult the provider-file fallback chain on resolution
 * failure.
 *
 * Note: chain mode (`config.models`) is handled by the LLM step executor's
 * runtime fallback loop, not here. This function operates on a single ref.
 */
export async function resolveChatModel(
  ctx: ActionCtx,
  config: LLMNodeConfig,
  orgSlug: string,
) {
  const explicit = typeof config.model === 'string' ? config.model.trim() : '';
  if (explicit.length > 0) {
    const { providerName, modelId } = parseModelRef(explicit);
    return resolveLanguageModelWithFallback(ctx, {
      modelId,
      providerName,
      tag: 'chat',
      orgSlug,
    });
  }
  return resolveLanguageModelWithFallback(ctx, { tag: 'chat', orgSlug });
}

/**
 * Reject a resolved model that is not tagged as a `chat` model. The
 * tag-based resolution path implicitly enforces this; the explicit-ref path
 * does not, so callers must invoke this guard.
 */
export function assertChatTag(
  modelData: ResolvedModelData,
  requestedRef: string | undefined,
): void {
  if (modelData.tags.includes('chat')) return;
  throw new ConvexError({
    code: 'INVALID_MODEL_FOR_LLM_STEP',
    message: requestedRef
      ? `Model ${requestedRef} resolved to ${modelData.providerName}:${modelData.modelId} which is not tagged as a chat model.`
      : `Model ${modelData.providerName}:${modelData.modelId} is not tagged as a chat model.`,
  });
}
