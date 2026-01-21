/**
 * Agent Execution with Tools
 *
 * Handles the core Agent execution logic with Agent SDK and tools support.
 *
 * Execution strategies based on output format and tools:
 * - Text output: Uses generateText directly
 * - JSON output without tools: Uses generateObject directly for reliable structured output
 * - JSON output with tools: Two-step approach:
 *   1. generateText with tools to collect information
 *   2. generateObject to structure the response
 */

import { Agent } from '@convex-dev/agent';
import { z } from 'zod/v4';
import { components } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import type {
  NormalizedConfig,
  ProcessedPrompts,
  LLMExecutionResult,
  ToolDiagnostics,
} from './types';
import { createAgentConfig } from '../../../../lib/create_agent_config';
import type { ToolName } from '../../../../agent_tools/tool_registry';
import { processAgentResult } from './utils/process_agent_result';
import { extractSchemaFields } from './utils/extract_schema_fields';

import { createDebugLog } from '../../../../lib/debug_log';

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
// AGENT EXECUTION
// =============================================================================

/**
 * Executes the Agent with tools and returns the result.
 *
 * Execution strategies:
 * - Text output: Uses generateText directly
 * - JSON output without tools: Uses generateObject directly
 * - JSON output with tools: Two-step approach (generateText then generateObject)
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
  if (config.outputFormat === 'json' && !config.outputSchema) {
    throw new Error(
      'outputSchema is required when outputFormat is "json". ' +
        'Provide a JSON schema to use structured output.',
    );
  }

  const hasTools = config.tools && config.tools.length > 0;
  const needsJsonOutput =
    config.outputFormat === 'json' && config.outputSchema;
  const zodSchema =
    needsJsonOutput && config.outputSchema
      ? z.fromJSONSchema(config.outputSchema)
      : null;

  const executionStrategy = needsJsonOutput
    ? hasTools
      ? 'json-with-tools (two-step)'
      : 'json-without-tools (generateObject)'
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
  const contextWithOrg = _args.organizationId
    ? { ...ctx, organizationId: _args.organizationId }
    : ctx;

  // Case 1: JSON output WITHOUT tools -> use generateObject directly
  if (needsJsonOutput && !hasTools && zodSchema) {
    return executeJsonOutputWithoutTools(
      contextWithOrg,
      config,
      prompts,
      zodSchema,
      threadId,
    );
  }

  // Case 2: JSON output WITH tools -> two-step approach
  if (needsJsonOutput && hasTools && zodSchema) {
    return executeJsonOutputWithTools(
      contextWithOrg,
      config,
      prompts,
      zodSchema,
      threadId,
    );
  }

  // Case 3: Text output -> use generateText directly
  return executeTextOutput(contextWithOrg, config, prompts, threadId);
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
  const threadId = thread._id as string;
  debugLog('executeAgentWithTools Created new thread', { threadId });
  return threadId;
}

async function executeJsonOutputWithoutTools(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  zodSchema: z.ZodType,
  threadId: string,
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
      model: config.model,
      outputFormat: config.outputFormat,
      instructions: prompts.systemPrompt,
    }),
  );

  const result = await agent.generateObject(
    ctx,
    { threadId },
    { prompt: prompts.userPrompt, schema: zodSchema },
    { contextOptions: { excludeToolMessages: false } },
  );

  const finalOutput = result.object;
  debugLog('executeJsonOutputWithoutTools COMPLETE', {
    outputKeys: Object.keys(finalOutput as Record<string, unknown>),
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

async function executeJsonOutputWithTools(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  zodSchema: z.ZodType,
  threadId: string,
): Promise<LLMExecutionResult> {
  // Extract required fields from output schema to guide the LLM
  const requiredFields = config.outputSchema
    ? extractSchemaFields(config.outputSchema)
    : [];

  // Enhance system prompt to ensure LLM includes all required field values
  // in its text output. This is critical for accurate JSON extraction in Step 2.
  const enhancedSystemPrompt =
    requiredFields.length > 0
      ? `${prompts.systemPrompt}

IMPORTANT OUTPUT REQUIREMENTS:
When presenting your findings, you MUST include the exact values for these fields in your text response:
${requiredFields.map((f) => `- ${f}`).join('\n')}

For each item you select/recommend, explicitly state ALL of these field values.
Example: "Product: [name] (ID: [_id], Price: [price], Image: [imageUrl])"
This is critical because these exact values will be extracted for structured output.`
      : prompts.systemPrompt;

  debugLog('executeJsonOutputWithTools START (two-step approach)', {
    configName: config.name,
    model: config.model,
    outputFormat: config.outputFormat,
    tools: config.tools,
    outputSchema: config.outputSchema,
    requiredFields,
    systemPromptPreview: enhancedSystemPrompt?.slice(0, 500),
    userPromptPreview: prompts.userPrompt?.slice(0, 500),
    threadId,
  });

  // Step 1: generateText with tools to collect information
  // Note: maxTokens uses model default, maxSteps defaults to 40 with tools,
  // temperature auto-determined by outputFormat (json→0.2, text→0.5)
  const toolAgent = new Agent(
    components.agent,
    createAgentConfig({
      name: config.name,
      model: config.model,
      outputFormat: 'text',
      instructions: enhancedSystemPrompt,
      convexToolNames: config.tools as ToolName[],
    }),
  );

  const textResult = await toolAgent.generateText(
    ctx,
    { threadId },
    { prompt: prompts.userPrompt },
    { contextOptions: { excludeToolMessages: false } },
  );

  const { agentSteps, toolDiagnostics } = processAgentResult(textResult);
  const textOutput = (textResult as { text?: string }).text ?? '';

  debugLog('executeJsonOutputWithTools STEP 1 COMPLETE (generateText)', {
    textOutputLength: textOutput.length,
    textOutput,
    stepsCount: Array.isArray(agentSteps) ? agentSteps.length : 0,
    agentSteps,
    toolDiagnostics,
  });

  // Step 2: generateObject to structure the response
  // The structureAgent uses the same threadId but excludes tool messages to save tokens.
  // The enhanced system prompt in Step 1 ensures required field values appear in the
  // text output, so Step 2 can extract them without seeing tool results directly.
  // Note: outputFormat 'json' will auto-set temperature to 0.2 for deterministic structuring
  const structureAgent = new Agent(
    components.agent,
    createAgentConfig({
      name: `${config.name}_structure`,
      model: config.model,
      outputFormat: 'json',
      instructions:
        'You are a data extraction assistant. Extract data ONLY from the previous assistant response - NEVER fabricate or invent information. If a field value is not explicitly stated in the conversation, omit it or use null. Use exact values (IDs, names, prices, etc.) as they appear in the source.',
    }),
  );

  // Prompt for Step 2 extraction
  const step2Prompt =
    'Extract the structured data from the assistant message above into JSON. CRITICAL: Only use information explicitly mentioned in the conversation. Never invent, guess, or fabricate any values. If a required field has no corresponding data, use the exact value from the source or leave it empty.';

  debugLog('executeJsonOutputWithTools STEP 2 START (generateObject)', {
    step2Prompt,
    outputSchema: config.outputSchema,
  });

  const objectResult = await structureAgent.generateObject(
    ctx,
    { threadId },
    {
      prompt: step2Prompt,
      schema: zodSchema,
    },
    { contextOptions: { excludeToolMessages: true } },
  );

  const finalOutput = objectResult.object;
  debugLog('executeJsonOutputWithTools STEP 2 COMPLETE', {
    outputKeys: Object.keys(finalOutput as Record<string, unknown>),
    finalOutput,
  });

  return {
    outputText: JSON.stringify(finalOutput, null, 2),
    finalOutput,
    agentSteps,
    toolDiagnostics,
    threadId,
  };
}

async function executeTextOutput(
  ctx: ActionCtx,
  config: NormalizedConfig,
  prompts: ProcessedPrompts,
  threadId: string,
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
      model: config.model,
      outputFormat: config.outputFormat,
      instructions: prompts.systemPrompt,
      convexToolNames: (config.tools ?? []) as ToolName[],
    }),
  );

  const result = await agent.generateText(
    ctx,
    { threadId },
    { prompt: prompts.userPrompt },
    { contextOptions: { excludeToolMessages: false } },
  );

  const { agentSteps, toolDiagnostics } = processAgentResult(result);
  const outputText = (result as { text?: string }).text ?? '';

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
