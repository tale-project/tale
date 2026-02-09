import { Agent } from '@convex-dev/agent';

import type { ToolName } from '../agent_tools/tool_registry';

import { loadConvexToolsAsObject } from '../agent_tools/load_convex_tools_as_object';
import { createDebugLog } from './debug_log';
import { getEnvOrThrow } from './get_or_throw';
import { openai } from './openai_provider';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[AgentConfig]');

/**
 * Create a general Agent configuration object compatible with @convex-dev/agent.
 *
 * - Supports merging Convex tools (by name) with extra tools (object)
 * - Supports extra tools (e.g., dynamic json_output tool) via extraTools option
 * - Appends instruction suffixes to ensure a final assistant message after tool use
 *   and stricter formatting when outputFormat === 'json'
 * - Optionally enables vector search for retrieving semantically relevant older messages
 */
export function createAgentConfig(opts: {
  name: string;
  model?: string;
  /** Temperature override. If not provided, auto-determined by outputFormat: json→0.2, text→0.5 */
  temperature?: number;
  maxTokens?: number;
  instructions: string;
  /** Output format - also determines default temperature if not explicitly set */
  outputFormat?: 'text' | 'json';
  convexToolNames?: ToolName[];
  /** Additional tools to merge (e.g., dynamic json_output tool) */
  extraTools?: Record<string, unknown>;
  maxSteps?: number;
  /** Enable vector search for finding semantically relevant older messages (defaults to false) */
  enableVectorSearch?: boolean;
  /** Use the fast model (OPENAI_FAST_MODEL) instead of the default model */
  useFastModel?: boolean;
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

  // Augment instructions to ensure a final assistant message after any tool use
  const suffixParts: string[] = [
    'If you use any tools, you must always conclude by producing a final assistant message with the answer.',
  ];
  if (opts.outputFormat === 'json') {
    suffixParts.push(
      'Return only a single JSON object and no extra commentary. If you used tools, still end with that JSON object.',
    );
  }

  // Add disambiguation rule for agents with request_human_input tool
  if (opts.convexToolNames?.includes('request_human_input')) {
    suffixParts.push(`
**DISAMBIGUATION RULE**
When searching for a specific record and finding MULTIPLE matches:
1. DO NOT proceed with all matches or pick one arbitrarily
2. Use request_human_input tool with format="single_select"
3. Include distinguishing details in each option (name, email, status, etc.)
4. STOP IMMEDIATELY after calling request_human_input - do NOT continue

CRITICAL: After calling request_human_input:
- You MUST produce your final response and STOP
- Do NOT call any more tools
- Do NOT assume what the user will select
- Do NOT generate a fake <human_response>
- The user's response will come in a FUTURE conversation turn

Example: User asks for "John's email" and you find 3 Johns:
→ Call request_human_input with options
→ Then STOP and say "I found 3 customers named John. Please select which one you mean from the options above."`);
  }

  const finalInstructions = [opts.instructions, suffixParts.join('\n\n')]
    .filter(Boolean)
    .join('\n\n');

  // DEBUG: Log system instructions size
  const estimatedInstructionTokens = Math.ceil(finalInstructions.length / 4);
  debugLog('System instructions analysis', {
    agentName: opts.name,
    instructionsLength: finalInstructions.length,
    estimatedInstructionTokens,
  });

  // Determine which model to use (priority order):
  // 1. Explicit model override from opts.model
  // 2. Fast model if useFastModel is true (requires OPENAI_FAST_MODEL env var)
  // 3. Default model (OPENAI_MODEL env var)
  const getModel = (): string => {
    if (opts.model) {
      return opts.model;
    }

    if (opts.useFastModel) {
      return getEnvOrThrow(
        'OPENAI_FAST_MODEL',
        'Fast model for chat agent - required when useFastModel is true',
      );
    }

    return getEnvOrThrow(
      'OPENAI_MODEL',
      'Default OpenAI model - required for Agent configuration',
    );
  };

  const model = getModel();

  // Call settings are intentionally empty
  // temperature and frequencyPenalty are not supported by reasoning models (e.g., DeepSeek V3.2)
  // and cause empty responses when set. Let the model use its defaults.
  const callSettings: Record<string, number> = {};

  // Build text embedding model for vector search if enabled
  // Requires OPENAI_EMBEDDING_MODEL env var to be set
  let embeddingModel: string | undefined;
  const enableVectorSearch = opts.enableVectorSearch ?? false;
  if (enableVectorSearch) {
    embeddingModel = getEnvOrThrow(
      'OPENAI_EMBEDDING_MODEL',
      'Embedding model - required when enableVectorSearch is true',
    );
  }

  const hasMaxTokens = typeof opts.maxTokens === 'number';

  // Default maxSteps to 40 when tools are configured but maxSteps is not set.
  // Without maxSteps, AI SDK defaults to stepCountIs(1), which prevents tool call loops
  // and can cause models to "simulate" tool calls as XML text output.
  const effectiveMaxSteps =
    hasAnyTools && typeof opts.maxSteps !== 'number' ? 40 : opts.maxSteps;

  return {
    name: opts.name,
    instructions: finalInstructions,
    languageModel: openai.chat(model),
    callSettings,
    ...(hasMaxTokens
      ? { providerOptions: { openai: { maxOutputTokens: opts.maxTokens } } }
      : {}),
    ...(hasAnyTools ? { tools: mergedTools } : {}),
    ...(typeof effectiveMaxSteps === 'number'
      ? { maxSteps: effectiveMaxSteps }
      : {}),
    // Add text embedding model for vector search
    ...(embeddingModel
      ? { textEmbeddingModel: openai.embedding(embeddingModel) }
      : {}),
  } as ConstructorParameters<typeof Agent>[1];
}
