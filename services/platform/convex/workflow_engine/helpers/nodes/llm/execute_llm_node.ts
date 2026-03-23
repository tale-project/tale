/**
 * LLM Node Executor - Helper Function
 *
 * Enhanced LLM node with support for Convex context tools.
 * Uses AI SDK with OpenAI provider and Agent SDK for tool integration.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { StepExecutionResult, LLMNodeConfig } from '../../../types';

import { executeAgentWithTools } from './execute_agent_with_tools';
import { createLLMResult } from './utils/create_llm_result';
import { processPrompts } from './utils/process_prompts';
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
  // 1. Validate and normalize configuration
  const normalizedConfig = validateAndNormalizeConfig(config);

  // 2. Process prompts with variable substitution
  const prompts = processPrompts(normalizedConfig, variables);

  // 3. Resolve knowledgeFileIds with variable substitution
  const knowledgeFileIds = resolveKnowledgeFileIds(
    normalizedConfig.knowledgeFileIds,
    variables,
  );

  // 4. Execute using Convex agent with tools
  const userId =
    typeof variables.userId === 'string' ? variables.userId : undefined;

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
    },
  );

  // 5. Create and return result
  return createLLMResult(llmResult, normalizedConfig, {
    threadId: llmResult.threadId,
  });
}
