/**
 * LLM Node Executor - Helper Function
 *
 * Enhanced LLM node with support for both Convex context tools and MCP tools.
 * Uses AI SDK with OpenAI provider and Agent SDK for tool integration.
 */

import type { StepExecutionResult, LLMNodeConfig } from '../../../types';
import type { ActionCtx } from '../../../../_generated/server';
import type { Id } from '../../../../_generated/dataModel';

// Tools integration
import { loadAllTools } from '../../../../agent_tools/load_all_tools';

// Validation
import { validateAndNormalizeConfig } from './utils/validate_and_normalize_config';
import { processPrompts } from './utils/process_prompts';

// Agent execution
import { executeAgentWithTools } from './execute_agent_with_tools';

// Result creation
import { createLLMResult } from './utils/create_llm_result';
import { ToolName } from '../../../../agent_tools/tool_registry';

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
): Promise<StepExecutionResult> {
  // 1. Validate and normalize configuration
  const normalizedConfig = validateAndNormalizeConfig(config);

  // 2. Process prompts with variable substitution
  const prompts = processPrompts(normalizedConfig, variables);

  // 3. Load tools (Convex + MCP)
  const tools = await loadAllTools(
    normalizedConfig.tools as ToolName[],
    normalizedConfig.mcpServerIds,
    variables,
  );

  // 4. Execute using Convex agent with tools
  const llmResult = await executeAgentWithTools(
    ctx,
    normalizedConfig,
    prompts,
    tools,
    {
      executionId,
      organizationId,
      threadId, // Pass shared threadId when reusing conversation context across steps
    },
  );

  // 5. Create and return result
  return createLLMResult(llmResult, normalizedConfig, tools, {
    threadId: llmResult.threadId, // Return the threadId used
  });
}
