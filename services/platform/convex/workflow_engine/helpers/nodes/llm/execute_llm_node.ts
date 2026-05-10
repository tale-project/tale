/**
 * LLM Node Executor - Helper Function
 *
 * Enhanced LLM node with support for Convex context tools.
 * Uses AI SDK with OpenAI provider and Agent SDK for tool integration.
 */

import { ConvexError } from 'convex/values';

import { parseModelRef } from '../../../../../lib/shared/utils/model-ref';
import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import { buildCallProviderOptions } from '../../../../lib/provider_options';
import { resolveOrgSlug } from '../../../../organizations/resolve_org_slug';
import { recordFailure } from '../../../../providers/circuit_breaker';
import {
  isTransientProviderError,
  shouldFailoverToNextModel,
} from '../../../../providers/errors';
import { resolveLanguageModelById } from '../../../../providers/resolve_model';
import type { StepExecutionResult, LLMNodeConfig } from '../../../types';
import { executeAgentWithTools } from './execute_agent_with_tools';
import { createLLMResult } from './utils/create_llm_result';
import { processPrompts } from './utils/process_prompts';
import { assertChatTag, resolveChatModel } from './utils/resolve_chat_model';
import { resolveKnowledgeFileIds } from './utils/resolve_knowledge_file_ids';
import { validateAndNormalizeConfig } from './utils/validate_and_normalize_config';

// =============================================================================
// HELPER FUNCTION
// =============================================================================

/**
 * Execute LLM node logic (helper function)
 *
 * Note: userAnswers and userProfile are injected into variables by
 * execute_step_handler.ts before config-level variable substitution. By the time
 * this function receives the config, {{userAnswers}} and {{userProfile}} have
 * already been resolved.
 *
 * Model resolution & runtime fallback:
 * - When `config.models` is set, the loop tries each ref in order. On a
 *   failover-eligible error (per `shouldFailoverToNextModel`) the next ref is
 *   tried; transient failures additionally record a circuit-breaker failure.
 * - When `config.model` is set (or neither), behavior is unchanged: a single
 *   resolution + single generation attempt.
 */
export async function executeLLMNode(
  ctx: ActionCtx,
  config: LLMNodeConfig,
  variables: Record<string, unknown>,
  executionId: string | Id<'wfExecutions'>,
  organizationId: string,
  threadId?: string,
  stepSlug?: string,
): Promise<StepExecutionResult> {
  const orgSlug = await resolveOrgSlug(ctx, organizationId);

  const explicit = typeof config.model === 'string' ? config.model.trim() : '';
  const chainEntries = Array.isArray(config.models)
    ? config.models
        .map((m) => (typeof m === 'string' ? m.trim() : ''))
        .filter((m) => m.length > 0)
    : [];

  if (explicit.length > 0 && chainEntries.length > 0) {
    throw new ConvexError({
      code: 'INVALID_LLM_STEP_CONFIG',
      message:
        'LLM step config: `model` and `models` are mutually exclusive — set one, not both.',
    });
  }

  const userId =
    typeof variables.userId === 'string' ? variables.userId : undefined;

  // Chain mode: per-attempt resolve + generate, with failover on errors.
  if (chainEntries.length > 0) {
    let lastError: unknown;
    for (let attempt = 0; attempt < chainEntries.length; attempt++) {
      const ref = chainEntries[attempt];
      const { providerName, modelId } = parseModelRef(ref);
      try {
        const { languageModel, modelData } = await resolveLanguageModelById(
          ctx,
          { modelId, providerName, orgSlug },
        );
        assertChatTag(modelData, ref);
        const normalizedConfig = validateAndNormalizeConfig(
          config,
          modelData.modelId,
        );
        const prompts = processPrompts(normalizedConfig, variables);
        const knowledgeFileIds = resolveKnowledgeFileIds(
          normalizedConfig.knowledgeFileIds,
          variables,
        );
        const llmResult = await executeAgentWithTools(
          ctx,
          normalizedConfig,
          prompts,
          {
            executionId,
            organizationId,
            threadId,
            stepSlug,
            knowledgeFileIds,
            userId,
            languageModel,
            resolvedModelId: modelData.modelId,
            providerOptions: buildCallProviderOptions(modelData),
            modelMaxOutputTokens: modelData.maxOutputTokens,
          },
        );
        return createLLMResult(llmResult, normalizedConfig, {
          threadId: llmResult.threadId,
        });
      } catch (err) {
        lastError = err;
        const hasMore = attempt < chainEntries.length - 1;
        if (!hasMore || !shouldFailoverToNextModel(err)) throw err;

        // Only transient failures count toward the circuit breaker.
        // Non-transient (401/404 config errors) are config bugs, not flakiness.
        if (isTransientProviderError(err)) {
          recordFailure(providerName ?? '', modelId);
        }
        console.warn(
          `[workflow LLM] model "${ref}" failed (${
            err instanceof Error ? err.message : String(err)
          }); falling over to "${chainEntries[attempt + 1]}"`,
        );
      }
    }
    throw lastError ?? new Error('No model in the chain could be resolved');
  }

  // Single-model / tag-default path: original behavior, no runtime fallback.
  const { languageModel, modelData: chatModelData } = await resolveChatModel(
    ctx,
    config,
    orgSlug,
  );
  assertChatTag(chatModelData, config.model);
  const normalizedConfig = validateAndNormalizeConfig(
    config,
    chatModelData.modelId,
  );
  const prompts = processPrompts(normalizedConfig, variables);
  const knowledgeFileIds = resolveKnowledgeFileIds(
    normalizedConfig.knowledgeFileIds,
    variables,
  );
  const llmResult = await executeAgentWithTools(
    ctx,
    normalizedConfig,
    prompts,
    {
      executionId,
      organizationId,
      threadId,
      stepSlug,
      knowledgeFileIds,
      userId,
      languageModel,
      resolvedModelId: chatModelData.modelId,
      providerOptions: buildCallProviderOptions(chatModelData),
      modelMaxOutputTokens: chatModelData.maxOutputTokens,
    },
  );
  return createLLMResult(llmResult, normalizedConfig, {
    threadId: llmResult.threadId,
  });
}
