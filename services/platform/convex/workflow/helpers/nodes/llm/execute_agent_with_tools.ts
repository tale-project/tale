/**
 * Agent Execution with Tools
 *
 * Handles the core Agent execution logic with Agent SDK and tools support.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import type {
  NormalizedConfig,
  ProcessedPrompts,
  LoadedTools,
  LLMExecutionResult,
} from './types';
import { createAgentConfig } from '../../../../lib/create_agent_config';
import type { ToolName } from '../../../../agent_tools/tool_registry';
import { processAgentResult } from './utils/process_agent_result';

import { createDebugLog } from '../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

// =============================================================================
// AGENT EXECUTION
// =============================================================================

/**
 * Executes the Agent with tools and returns the result
 */
export async function executeAgentWithTools(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  tools: LoadedTools,
  _args: {
    executionId: string | unknown;
    organizationId?: string;
    threadId?: string;
  },
): Promise<LLMExecutionResult> {
  // Helper to extract JSON from markdown code blocks or plain text
  const extractJsonText = (text: string): string => {
    const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    return m ? m[1].trim() : text.trim();
  };
  const getSteps = (res: unknown): unknown[] => {
    const steps = (res as { steps?: unknown[] })?.steps;
    return Array.isArray(steps) ? steps : [];
  };

  // 1) Build agent and identifiers
  const agentConfig = createAgentConfig({
    name: config.name,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    maxSteps: config.maxSteps, // Pass maxSteps to agent config
    instructions: prompts.systemPrompt,
    outputFormat: config.outputFormat,
    convexToolNames: (config.tools ?? []) as ToolName[],
    mcpTools: tools.mcpTools,
  });

  // Reuse existing threadId when provided, otherwise create a new one
  let threadId: string;
  if (_args.threadId) {
    // Reuse shared thread when threadId is provided
    threadId = _args.threadId;
    debugLog('executeAgentWithTools Reusing shared thread', { threadId });
  } else {
    // Workflows without a threadId (e.g., data sync or standalone LLM) create a new thread
    const thread = await ctx.runMutation(
      components.agent.threads.createThread,
      {
        title: `workflow:${config.name || 'LLM'}`,
      },
    );
    threadId = thread._id as string;
    debugLog('executeAgentWithTools Created new thread', { threadId });
  }

  const agent = new Agent(components.agent, agentConfig);

  // Add organizationId to context for tools that need it
  const contextWithOrg = _args.organizationId
    ? { ...ctx, organizationId: _args.organizationId }
    : ctx;

  // 2) First generation
  let result = await agent.generateText(
    contextWithOrg,
    { threadId },
    { prompt: prompts.userPrompt },
    { contextOptions: { excludeToolMessages: false } },
  );

  // 3) Extract initial output text (don't parse JSON yet)
  let outputText = (result as { text?: string }).text ?? '';

  // 4) Decide if a concluding turn is required (simple rule)
  const needFinal =
    (!outputText || !outputText.trim()) && getSteps(result).length > 0;

  if (needFinal) {
    // 5) Build a clear concluding prompt with grounding from last tool result
    const concludePrompt =
      config.outputFormat === 'json'
        ? 'Conclude now. Return ONLY the final JSON object matching the required schema. No extra text.'
        : 'Conclude now with the final concise answer.';

    // 6) Run the concluding turn with a no-tools agent to force an assistant message
    const finalizeConfig = createAgentConfig({
      name: config.name,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      instructions: prompts.systemPrompt,
      outputFormat: config.outputFormat,
    });
    const finalizeAgent = new Agent(components.agent, finalizeConfig);
    const finalize = await finalizeAgent.generateText(
      contextWithOrg,
      { threadId },
      { prompt: concludePrompt },
      { contextOptions: { excludeToolMessages: false } },
    );

    // 7) Use the finalize result as the final output basis
    result = finalize;
    outputText = (finalize as { text?: string }).text ?? '';
  }

  // 8) Process final steps + tool diagnostics
  const { agentSteps, toolDiagnostics } = processAgentResult(result);

  // 9) Fallback: still empty -> use the last tool result text (best effort)
  if (
    (!outputText || !outputText.trim()) &&
    toolDiagnostics.lastToolResultText
  ) {
    outputText = toolDiagnostics.lastToolResultText;
  }

  // 10) Parse JSON if requested (only after all output determination logic)
  let finalOutput: unknown = outputText;
  if (config.outputFormat === 'json') {
    const jsonText = extractJsonText(outputText);
    if (!jsonText || !jsonText.trim()) {
      const stepsCount = Array.isArray(agentSteps) ? agentSteps.length : 0;
      throw new Error(
        `Agent configured for JSON output but returned empty text. ` +
          `Steps executed: ${stepsCount}, ` +
          `Last tool result available: ${!!toolDiagnostics.lastToolResultText}`,
      );
    }
    finalOutput = JSON.parse(jsonText);
  }

  // 11) Return consolidated result
  return {
    outputText,
    finalOutput,
    agentSteps,
    toolDiagnostics,
    threadId, // Return the threadId used for this execution
  };
}
