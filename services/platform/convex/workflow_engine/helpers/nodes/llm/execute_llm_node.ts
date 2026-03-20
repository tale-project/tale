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

  // 2. Process prompts with variable substitution
  const prompts = processPrompts(normalizedConfig, variables);

  // 2.5. Inject prior human input responses into system prompt (for workflow context)
  if (executionId) {
    try {
      const respondedApprovals = await ctx.runQuery(
        internal.approvals.internal_queries.listRespondedForExecution,
        { executionId: toId<'wfExecutions'>(executionId) },
      );
      if (respondedApprovals.length > 0) {
        const context = respondedApprovals
          .map(
            (a: { question: string; response: string | string[] }) =>
              `- Q: "${a.question}" → A: "${Array.isArray(a.response) ? a.response.join(', ') : a.response}"`,
          )
          .join('\n');
        prompts.systemPrompt += `\n\n<human_input_context>\nThe following information was provided by the user during this workflow:\n${context}\n</human_input_context>`;
        debugLog('Injected human input context into system prompt', {
          responseCount: respondedApprovals.length,
        });
      }
    } catch {
      // Non-critical: skip if query fails (e.g., executionId is not a valid wfExecutions ID)
    }
  }

  // 3. Execute using Convex agent with tools
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

  // 4. Create and return result
  return createLLMResult(llmResult, normalizedConfig, {
    threadId: llmResult.threadId, // Return the threadId used
  });
}
