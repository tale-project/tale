import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';

import { loadConvexToolsAsObject } from '../agent_tools/load_convex_tools_as_object';
import type { ToolName } from '../agent_tools/tool_registry';
import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[AgentConfig]');

/**
 * Create a general Agent configuration object compatible with @convex-dev/agent.
 *
 * Pure config assembly: merges Convex tools (by name) with extra tools, picks
 * maxOutputTokens / maxSteps defaults, and passes `instructions` through as-is.
 * Tool behavior rules live on each tool's own `description`; agent system prompts
 * live on the agent config. This factory does not wrap or mutate `instructions`.
 *
 * Note: `providerOptions` is NOT part of the agent config. Pass it per-call to
 * `agent.streamText({ providerOptions })` / `agent.generateText({...})` /
 * `agent.generateObject({...})`. The agent-level field on `@convex-dev/agent` is
 * `@deprecated` and will be removed; the per-call form is the supported path.
 */
export function createAgentConfig(opts: {
  name: string;
  /** Pre-resolved language model instance from the provider */
  languageModel: LanguageModelV3;
  /** Pre-resolved text embedding model for vector search */
  textEmbeddingModel?: unknown;
  /**
   * Caller-specified output cap. Wins over `modelMaxOutputTokens` and the
   * default. Use 0 to opt out (unlimited).
   */
  maxTokens?: number;
  /**
   * Per-model cap from `modelData.maxOutputTokens`. Used when the caller
   * doesn't provide an explicit `maxTokens`. Lets a provider config raise or
   * lower the default for a specific model (e.g. mistral entries declare
   * `maxOutputTokens: 8192` to escape OpenRouter's lower default).
   */
  modelMaxOutputTokens?: number;
  instructions: string;
  convexToolNames?: ToolName[];
  /** Additional tools to merge (e.g., dynamic json_output tool) */
  extraTools?: Record<string, unknown>;
  maxSteps?: number;
}): ConstructorParameters<typeof Agent>[1] {
  // Build Convex tools as an object when names are provided
  const convexToolsObject = opts.convexToolNames?.length
    ? loadConvexToolsAsObject(opts.convexToolNames)
    : {};

  // Merge Convex tools + extra tools into a single tools object
  const mergedTools: Record<string, unknown> = {
    ...convexToolsObject,
    ...opts.extraTools,
  };

  const hasAnyTools = Object.keys(mergedTools).length > 0;

  // DEBUG: Log tool definitions size for token analysis
  // Tool definitions are sent to the model and consume input tokens
  if (hasAnyTools) {
    const toolNames = Object.keys(mergedTools);
    // Estimate tool definition tokens by serializing to JSON
    // This gives us a rough idea of how much the tool definitions cost
    const toolDefsJson = JSON.stringify(mergedTools, (key, value) => {
      // Skip function values (handlers) as they're not sent to the model
      if (typeof value === 'function') return '[Function]';
      return value;
    });
    // Rough token estimate: ~4 chars per token for JSON
    const estimatedToolTokens = Math.ceil(toolDefsJson.length / 4);
    debugLog('Tool definitions analysis', {
      agentName: opts.name,
      toolCount: toolNames.length,
      toolNames,
      toolDefsJsonLength: toolDefsJson.length,
      estimatedToolTokens,
    });
  }

  const estimatedInstructionTokens = Math.ceil(
    (opts.instructions?.length ?? 0) / 4,
  );
  debugLog('System instructions analysis', {
    agentName: opts.name,
    instructionsLength: opts.instructions?.length ?? 0,
    estimatedInstructionTokens,
  });

  // Call settings: cap output tokens via priority caller > model config >
  // 8192 default. The default keeps OpenRouter from truncating responses
  // with its much lower built-in cap. Temperature and frequencyPenalty are
  // intentionally NOT set — reasoning models (e.g. DeepSeek V3.2) treat
  // them as `0` and return empty content.
  const callSettings: Record<string, number> = {
    maxOutputTokens:
      typeof opts.maxTokens === 'number'
        ? opts.maxTokens
        : typeof opts.modelMaxOutputTokens === 'number'
          ? opts.modelMaxOutputTokens
          : 8192,
  };

  // Default maxSteps to 40 when tools are configured but maxSteps is not set.
  // Without maxSteps, AI SDK defaults to stepCountIs(1), which prevents tool call loops
  // and can cause models to "simulate" tool calls as XML text output.
  const effectiveMaxSteps =
    hasAnyTools && typeof opts.maxSteps !== 'number' ? 40 : opts.maxSteps;

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Agent config is dynamically assembled from heterogeneous tool sources (createTool results, integration-bound tools); the ToolSet branded type cannot be satisfied statically
  return {
    name: opts.name,
    instructions: opts.instructions,
    languageModel: opts.languageModel,
    callSettings,
    ...(hasAnyTools ? { tools: mergedTools } : {}),
    ...(typeof effectiveMaxSteps === 'number'
      ? { maxSteps: effectiveMaxSteps }
      : {}),
    ...(opts.textEmbeddingModel
      ? { embeddingModel: opts.textEmbeddingModel }
      : {}),
  } as ConstructorParameters<typeof Agent>[1];
}
