/**
 * Agent Execution with Tools
 *
 * Handles the core Agent execution logic with Agent SDK and tools support.
 * Uses a single generateText call for all scenarios:
 * - Plain text output: Returns the text response directly
 * - Structured JSON output: Uses the json_output tool to capture schema-validated output
 *
 * The json_output tool approach is used for all structured output because generateObject
 * doesn't support tools in @convex-dev/agent.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import type {
  NormalizedConfig,
  ProcessedPrompts,
  LLMExecutionResult,
} from './types';
import { createAgentConfig } from '../../../../lib/create_agent_config';
import {
  createJsonOutputTool,
  type JsonOutputToolResult,
} from '../../../../agent_tools/create_json_output_tool';
import type { ToolName } from '../../../../agent_tools/tool_registry';
import { processAgentResult } from './utils/process_agent_result';

import { createDebugLog } from '../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

// =============================================================================
// AGENT EXECUTION
// =============================================================================

/**
 * Executes the Agent with tools and returns the result.
 *
 * Uses a unified approach with a single generateText call:
 * - When outputSchema is provided, adds the json_output tool to capture structured output
 * - When no outputSchema, returns the plain text response
 */
export async function executeAgentWithTools(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  _args: {
    executionId: string | unknown;
    organizationId?: string;
    threadId?: string;
  },
): Promise<LLMExecutionResult> {
  // Validate: JSON output format requires an output schema
  if (config.outputFormat === 'json' && !config.outputSchema) {
    throw new Error(
      'outputSchema is required when outputFormat is "json". ' +
        'Provide a JSON schema to use structured output.',
    );
  }

  // Create json_output tool if structured output is requested
  const jsonOutputTool: JsonOutputToolResult | null = config.outputSchema
    ? createJsonOutputTool(config.outputSchema)
    : null;

  // Build agent configuration
  const agentConfig = createAgentConfig({
    name: config.name,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    maxSteps: config.maxSteps,
    instructions: prompts.systemPrompt,
    outputFormat: config.outputFormat,
    convexToolNames: (config.tools ?? []) as ToolName[],
    extraTools: jsonOutputTool ? { json_output: jsonOutputTool.tool } : undefined,
  });

  // Get or create thread
  let threadId: string;
  if (_args.threadId) {
    threadId = _args.threadId;
    debugLog('executeAgentWithTools Reusing shared thread', { threadId });
  } else {
    const thread = await ctx.runMutation(components.agent.threads.createThread, {
      title: `workflow:${config.name || 'LLM'}`,
    });
    threadId = thread._id as string;
    debugLog('executeAgentWithTools Created new thread', { threadId });
  }

  // Create agent and context
  const agent = new Agent(components.agent, agentConfig);
  const contextWithOrg = _args.organizationId
    ? { ...ctx, organizationId: _args.organizationId }
    : ctx;

  debugLog('executeAgentWithTools Executing', {
    hasOutputSchema: !!config.outputSchema,
    toolCount: (config.tools?.length ?? 0) + (jsonOutputTool ? 1 : 0),
    userPromptLength: prompts.userPrompt?.length ?? 0,
    systemPromptLength: prompts.systemPrompt?.length ?? 0,
  });

  // processPrompts ensures we always have a valid userPrompt
  // (either from config or a default prompt when config userPrompt is empty)

  // Single generateText call for all scenarios
  let result;
  try {
    result = await agent.generateText(
      contextWithOrg,
      { threadId },
      { prompt: prompts.userPrompt },
      { contextOptions: { excludeToolMessages: false } },
    );
  } catch (error) {
    // Provide more context when AI SDK fails
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `LLM generation failed: ${errorMessage}. ` +
        `Thread: ${threadId}, ` +
        `User prompt length: ${prompts.userPrompt?.length ?? 0}, ` +
        `System prompt length: ${prompts.systemPrompt?.length ?? 0}`,
    );
  }

  const { agentSteps, toolDiagnostics } = processAgentResult(result);

  // Handle structured output (json_output tool was used)
  if (jsonOutputTool) {
    if (!jsonOutputTool.wasCalled()) {
      const stepsCount = Array.isArray(agentSteps) ? agentSteps.length : 0;
      throw new Error(
        `Agent did not call json_output tool. ` +
          `Steps executed: ${stepsCount}, ` +
          `Last tool: ${toolDiagnostics.lastToolName ?? 'none'}`,
      );
    }

    const finalOutput = jsonOutputTool.getCapturedOutput();

    debugLog('executeAgentWithTools Structured output captured', {
      outputKeys: Object.keys(finalOutput as Record<string, unknown>),
    });

    return {
      outputText: JSON.stringify(finalOutput, null, 2),
      finalOutput,
      agentSteps,
      toolDiagnostics,
      threadId,
    };
  }

  // Handle plain text output
  const outputText = (result as { text?: string }).text ?? '';

  if (!outputText || !outputText.trim()) {
    const stepsCount = Array.isArray(agentSteps) ? agentSteps.length : 0;
    throw new Error(
      `Agent returned empty text output. ` +
        `Steps executed: ${stepsCount}, ` +
        `Last tool: ${toolDiagnostics.lastToolName ?? 'none'}`,
    );
  }

  debugLog('executeAgentWithTools Text output generated', {
    outputLength: outputText.length,
  });

  return {
    outputText,
    finalOutput: outputText,
    agentSteps,
    toolDiagnostics,
    threadId,
  };
}
