/**
 * Agent Execution with Tools
 *
 * Handles the core Agent execution logic with Agent SDK and tools support.
 *
 * Execution strategies based on output format and tools:
 * - Text output: Uses generateText directly (with or without tools)
 * - JSON output without tools: Uses generateObject directly for reliable structured output
 * - JSON output with tools: NOT ALLOWED — split into two explicit LLM steps
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';

import { Agent } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ActionCtx } from '../../../../_generated/server';
import type { ToolName } from '../../../../agent_tools/tool_names';
import type {
  NormalizedConfig,
  ProcessedPrompts,
  LLMExecutionResult,
  ToolDiagnostics,
} from './types';

import { isRecord } from '../../../../../lib/utils/type-guards';
import { components } from '../../../../_generated/api';
import {
  estimateTokens,
  AGENT_CONTEXT_CONFIGS,
  CONTEXT_SAFETY_MARGIN,
} from '../../../../lib/context_management';
import { createAgentConfig } from '../../../../lib/create_agent_config';
import { createDebugLog } from '../../../../lib/debug_log';
import { processAgentResult } from './utils/process_agent_result';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

// =============================================================================
// CONSTANTS
// =============================================================================

const EMPTY_TOOL_DIAGNOSTICS: ToolDiagnostics = {
  lastToolName: null,
  lastToolInputText: null,
  lastToolResultText: null,
};

// =============================================================================
// CONTEXT BUDGET CHECK
// =============================================================================

function checkPromptBudget(systemPrompt: string, userPrompt: string): void {
  const sysTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userPrompt);
  const total = sysTokens + userTokens;
  const { modelContextLimit, outputReserve } = AGENT_CONTEXT_CONFIGS.workflow;
  const budget = modelContextLimit * CONTEXT_SAFETY_MARGIN - outputReserve;

  if (total > budget) {
    throw new Error(
      `LLM step prompt exceeds context budget: ~${total} tokens ` +
        `(budget: ${Math.round(budget)}, system: ${sysTokens}, user: ${userTokens}). ` +
        `Reduce prompt size or split the input into smaller batches.`,
    );
  }

  if (total > budget * 0.85) {
    debugLog('LLM step approaching context limit', {
      estimatedTokens: total,
      budget: Math.round(budget),
      systemTokens: sysTokens,
      userTokens,
    });
  }
}

// =============================================================================
// AGENT EXECUTION
// =============================================================================

/**
 * Executes the Agent with tools and returns the result.
 *
 * Execution strategies:
 * - Text output: Uses generateText directly
 * - JSON output without tools: Uses generateObject directly
 */
export async function executeAgentWithTools(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  _args: {
    executionId: string;
    organizationId?: string;
    userId?: string;
    threadId?: string;
    stepSlug?: string;
    knowledgeFileIds?: string[];
    languageModel: LanguageModelV3;
  },
): Promise<LLMExecutionResult> {
  if (config.outputFormat === 'json' && !config.outputSchema) {
    throw new Error(
      'outputSchema is required when outputFormat is "json". ' +
        'Provide a JSON schema to use structured output.',
    );
  }

  checkPromptBudget(prompts.systemPrompt, prompts.userPrompt);

  const hasTools = config.tools && config.tools.length > 0;
  const needsJsonOutput = config.outputFormat === 'json' && config.outputSchema;
  const zodSchema =
    needsJsonOutput && config.outputSchema
      ? z.fromJSONSchema(config.outputSchema)
      : null;

  const executionStrategy = needsJsonOutput
    ? 'json-without-tools (generateObject)'
    : 'text (generateText)';

  debugLog('executeAgentWithTools ENTRY', {
    configName: config.name,
    outputFormat: config.outputFormat,
    hasOutputSchema: !!config.outputSchema,
    hasTools,
    toolCount: config.tools?.length ?? 0,
    executionStrategy,
    existingThreadId: _args.threadId,
  });

  const threadId = await getOrCreateThread(ctx, config.name, _args.threadId);
  const contextWithOrg = {
    ...ctx,
    ...(_args.organizationId ? { organizationId: _args.organizationId } : {}),
    ...(_args.userId ? { userId: _args.userId } : {}),
    ...(_args.executionId ? { wfExecutionId: _args.executionId } : {}),
    ...(_args.stepSlug ? { stepSlug: _args.stepSlug } : {}),
    ...(_args.knowledgeFileIds?.length
      ? { knowledgeFileIds: _args.knowledgeFileIds }
      : {}),
  };

  // Case 1: JSON output WITHOUT tools -> use generateObject directly
  if (needsJsonOutput && !hasTools && zodSchema) {
    return executeJsonOutputWithoutTools(
      contextWithOrg,
      config,
      prompts,
      zodSchema,
      threadId,
      _args.userId,
      _args.languageModel,
    );
  }

  // Case 2: JSON output WITH tools -> not allowed (must be split into two steps)
  if (needsJsonOutput && hasTools) {
    throw new Error(
      'LLM step cannot use both tools and outputFormat "json". ' +
        'Split into two steps: first use tools with text output, then use a second LLM step with json output to structure the result.',
    );
  }

  // Case 3: Text output -> use generateText directly
  return executeTextOutput(
    contextWithOrg,
    config,
    prompts,
    threadId,
    _args.userId,
    _args.languageModel,
  );
}

// =============================================================================
// EXECUTION STRATEGIES
// =============================================================================

async function getOrCreateThread(
  ctx: ActionCtx,
  name: string,
  existingThreadId?: string,
): Promise<string> {
  if (existingThreadId) {
    debugLog('executeAgentWithTools Reusing shared thread', {
      threadId: existingThreadId,
    });
    return existingThreadId;
  }

  const thread = await ctx.runMutation(components.agent.threads.createThread, {
    title: `workflow:${name || 'LLM'}`,
  });
  const threadId = thread._id;
  debugLog('executeAgentWithTools Created new thread', { threadId });
  return threadId;
}

async function executeJsonOutputWithoutTools(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  zodSchema: z.ZodType,
  threadId: string,
  userId: string | undefined,
  languageModel: LanguageModelV3,
): Promise<LLMExecutionResult> {
  debugLog('executeJsonOutputWithoutTools START', {
    configName: config.name,
    model: config.model,
    outputFormat: config.outputFormat,
    outputSchema: config.outputSchema,
    systemPromptPreview: prompts.systemPrompt?.slice(0, 200),
    userPromptPreview: prompts.userPrompt?.slice(0, 200),
    threadId,
  });

  // Note: temperature is auto-determined by createAgentConfig based on outputFormat
  // (json→0.2, text→0.5)
  const agent = new Agent(
    components.agent,
    createAgentConfig({
      name: config.name,
      languageModel,
      outputFormat: config.outputFormat,
      instructions: prompts.systemPrompt,
    }),
  );

  const result = await agent.generateObject(
    ctx,
    { threadId, userId },
    { prompt: prompts.userPrompt, schema: zodSchema },
    { contextOptions: { excludeToolMessages: false } },
  );

  const finalOutput = result.object;
  debugLog('executeJsonOutputWithoutTools COMPLETE', {
    outputKeys: isRecord(finalOutput) ? Object.keys(finalOutput) : [],
    finalOutput,
  });

  return {
    outputText: JSON.stringify(finalOutput, null, 2),
    finalOutput,
    agentSteps: [],
    toolDiagnostics: EMPTY_TOOL_DIAGNOSTICS,
    threadId,
  };
}

async function executeTextOutput(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  threadId: string,
  userId: string | undefined,
  languageModel: LanguageModelV3,
): Promise<LLMExecutionResult> {
  debugLog('executeTextOutput START', {
    configName: config.name,
    model: config.model,
    outputFormat: config.outputFormat,
    tools: config.tools,
    systemPromptPreview: prompts.systemPrompt?.slice(0, 200),
    userPromptPreview: prompts.userPrompt?.slice(0, 200),
    threadId,
  });

  // Note: maxTokens uses model default, maxSteps defaults to 40 with tools,
  // temperature auto-determined by outputFormat (json→0.2, text→0.5)
  const agent = new Agent(
    components.agent,
    createAgentConfig({
      name: config.name,
      languageModel,
      outputFormat: config.outputFormat,
      instructions: prompts.systemPrompt,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- config.tools contains valid ToolName strings from workflow step configuration
      convexToolNames: (config.tools ?? []) as ToolName[],
    }),
  );

  const result = await agent.generateText(
    ctx,
    { threadId, userId },
    { prompt: prompts.userPrompt },
    { contextOptions: { excludeToolMessages: false } },
  );

  const { agentSteps, toolDiagnostics } = processAgentResult(result);
  const outputText = (
    isRecord(result) && typeof result.text === 'string' ? result.text : ''
  ).trim();

  if (!outputText || !outputText.trim()) {
    const stepsCount = Array.isArray(agentSteps) ? agentSteps.length : 0;
    throw new Error(
      `Agent returned empty text output. ` +
        `Steps executed: ${stepsCount}, ` +
        `Last tool: ${toolDiagnostics.lastToolName ?? 'none'}`,
    );
  }

  debugLog('executeTextOutput COMPLETE', {
    outputLength: outputText.length,
    outputText,
    agentSteps,
    toolDiagnostics,
  });

  return {
    outputText,
    finalOutput: outputText,
    agentSteps,
    toolDiagnostics,
    threadId,
  };
}
