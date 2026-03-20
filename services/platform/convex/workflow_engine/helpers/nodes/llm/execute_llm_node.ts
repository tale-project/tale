/**
 * LLM Node Executor - Helper Function
 *
 * Enhanced LLM node with support for Convex context tools.
 * Uses AI SDK with OpenAI provider and Agent SDK for tool integration.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { StepExecutionResult, LLMNodeConfig } from '../../../types';

import { internal } from '../../../../_generated/api';
import { createDebugLog } from '../../../../lib/debug_log';
import { toId } from '../../../../lib/type_cast_helpers';
// Agent execution
import { executeAgentWithTools } from './execute_agent_with_tools';
// Result creation
import { createLLMResult } from './utils/create_llm_result';
import { processPrompts } from './utils/process_prompts';
// Validation
import { validateAndNormalizeConfig } from './utils/validate_and_normalize_config';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[LLMNode]');

// =============================================================================
// HELPER FUNCTION
// =============================================================================

/**
 * Execute LLM node logic (helper function)
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

  // 2. Build prompt-scoped variables with {{humanInputContext}} support.
  // We create a shallow copy instead of mutating `variables` because:
  // - The original `variables` object is persisted to execution state by
  //   persistExecutionResult() in execute_step_handler.ts after this function returns.
  // - humanInputContext is an ephemeral, prompt-only value that must be freshly
  //   computed from the DB on each step execution, not stored in execution state.
  // - Storing it would cause stale context after human input replay: the persisted
  //   value from run N would shadow the fresh query result in run N+1.
  let promptVariables = variables;
  if (executionId) {
    const respondedApprovals = await ctx.runQuery(
      internal.approvals.internal_queries.listRespondedForExecution,
      { executionId: toId<'wfExecutions'>(executionId) },
    );
    const humanInputContext =
      respondedApprovals.length > 0
        ? [
            '<human_input_context>',
            'The following information was provided by the user during this workflow. Use these values directly — do not re-ask for information already provided.',
            ...respondedApprovals.map(
              (a: { question: string; response: string | string[] }) =>
                `- Q: "${a.question}" → A: "${Array.isArray(a.response) ? a.response.join(', ') : a.response}"`,
            ),
            '</human_input_context>',
          ].join('\n')
        : '';
    promptVariables = { ...variables, humanInputContext };
    if (respondedApprovals.length > 0) {
      debugLog('Built humanInputContext for prompt variables', {
        responseCount: respondedApprovals.length,
      });
    }
  }

  // 3. Process prompts with variable substitution
  const prompts = processPrompts(normalizedConfig, promptVariables);

  // 4. Execute using Convex agent with tools
  const llmResult = await executeAgentWithTools(
    ctx,
    normalizedConfig,
    prompts,
    {
      executionId,
      organizationId,
      threadId, // Pass shared threadId when reusing conversation context across steps
      stepSlug,
    },
  );

  // 5. Create and return result
  return createLLMResult(llmResult, normalizedConfig, {
    threadId: llmResult.threadId, // Return the threadId used
  });
}
