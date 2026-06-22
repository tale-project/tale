/**
 * LLM Node Executor - Helper Function
 *
 * Enhanced LLM node with support for Convex context tools.
 * Uses AI SDK with OpenAI provider and Agent SDK for tool integration.
 */

import { ConvexError } from 'convex/values';

import { classifyChatErrorCode } from '../../../../../lib/shared/chat-errors';
import { parseModelRef } from '../../../../../lib/shared/utils/model-ref';
import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import { reasoningProviderOptionsFor } from '../../../../lib/agent_response/reasoning/build_reasoning_options';
import { buildCallProviderOptions } from '../../../../lib/provider_options';
import { recordFailure } from '../../../../providers/circuit_breaker';
import {
  classifyFailureScope,
  isTransientProviderError,
} from '../../../../providers/errors';
import {
  isModelScopeRetired,
  retiredScopeKey,
} from '../../../../providers/failure_scope';
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
  //
  // A model that fails with a DETERMINISTIC provider-level error retires the
  // failing resource — the credential (provider + key) for funds/auth, the
  // endpoint for an unreachable host — so its siblings are skipped, while a
  // sibling with its own `secretsEnv` key is still tried. Resolution (no HTTP)
  // is memoized per index so the failover lookahead doesn't pay for it twice.
  if (chainEntries.length > 0) {
    let lastError: unknown;
    const deadScopes = new Set<string>();
    type Resolution =
      | {
          ok: true;
          resolved: Awaited<ReturnType<typeof resolveLanguageModelById>>;
        }
      | { ok: false; error: unknown };
    const resolutionCache = new Map<number, Resolution>();
    const resolveAt = async (index: number): Promise<Resolution> => {
      const cached = resolutionCache.get(index);
      if (cached) return cached;
      const { providerName, modelId } = parseModelRef(chainEntries[index]);
      let result: Resolution;
      try {
        result = {
          ok: true,
          resolved: await resolveLanguageModelById(ctx, {
            modelId,
            providerName,
            organizationId,
          }),
        };
      } catch (error) {
        result = { ok: false, error };
      }
      resolutionCache.set(index, result);
      return result;
    };
    const findNextAttemptable = async (from: number): Promise<number> => {
      for (let i = from; i < chainEntries.length; i++) {
        const r = await resolveAt(i);
        if (r.ok && !isModelScopeRetired(r.resolved.modelData, deadScopes)) {
          return i;
        }
      }
      return -1;
    };

    for (let attempt = 0; attempt < chainEntries.length; attempt++) {
      const ref = chainEntries[attempt];
      const { providerName, modelId } = parseModelRef(ref);

      const resolution = await resolveAt(attempt);
      if (!resolution.ok) {
        lastError = resolution.error;
        if (attempt < chainEntries.length - 1) {
          console.warn(
            `[workflow LLM] model "${ref}" failed to resolve (${
              resolution.error instanceof Error
                ? resolution.error.message
                : String(resolution.error)
            }); trying the next model`,
          );
          continue;
        }
        throw resolution.error;
      }

      // Skip a model whose credential/endpoint was already retired this chain.
      if (isModelScopeRetired(resolution.resolved.modelData, deadScopes)) {
        continue;
      }

      try {
        const { languageModel, modelData } = resolution.resolved;
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
            providerOptions: reasoningProviderOptionsFor(
              modelData,
              buildCallProviderOptions(modelData),
              {
                kind: 'subagent',
                promptText: prompts.userPrompt,
                toolCount: normalizedConfig.tools?.length ?? 0,
              },
            ),
            modelMaxOutputTokens: modelData.maxOutputTokens,
          },
        );
        return createLLMResult(llmResult, normalizedConfig, {
          threadId: llmResult.threadId,
        });
      } catch (err) {
        lastError = err;

        // Terminal: fails on any model — don't walk the chain.
        if (classifyFailureScope(err) === 'terminal') throw err;

        // Deterministic provider-level failure — retire the failing resource
        // (credential for funds/auth, endpoint for an unreachable host).
        const retired = retiredScopeKey(
          classifyChatErrorCode(err),
          resolution.resolved.modelData,
        );
        if (retired) deadScopes.add(retired);

        // Only transient failures count toward the circuit breaker.
        // Non-transient (401/404 config errors) are config bugs, not flakiness.
        if (isTransientProviderError(err)) {
          recordFailure(providerName ?? '', modelId);
        }

        const nextIndex = await findNextAttemptable(attempt + 1);
        if (nextIndex === -1) throw err;
        console.warn(
          `[workflow LLM] model "${ref}" failed (${
            err instanceof Error ? err.message : String(err)
          }); falling over to "${chainEntries[nextIndex]}"`,
        );
      }
    }
    throw lastError ?? new Error('No model in the chain could be resolved');
  }

  // Single-model / tag-default path: original behavior, no runtime fallback.
  const { languageModel, modelData: chatModelData } = await resolveChatModel(
    ctx,
    config,
    organizationId,
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
      providerOptions: reasoningProviderOptionsFor(
        chatModelData,
        buildCallProviderOptions(chatModelData),
        {
          kind: 'subagent',
          promptText: prompts.userPrompt,
          toolCount: normalizedConfig.tools?.length ?? 0,
        },
      ),
      modelMaxOutputTokens: chatModelData.maxOutputTokens,
    },
  );
  return createLLMResult(llmResult, normalizedConfig, {
    threadId: llmResult.threadId,
  });
}
