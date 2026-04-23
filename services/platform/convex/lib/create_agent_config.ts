import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';

import { loadConvexToolsAsObject } from '../agent_tools/load_convex_tools_as_object';
import type { ToolName } from '../agent_tools/tool_registry';
import { createDebugLog } from './debug_log';

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
  /** Pre-resolved language model instance from the provider */
  languageModel: LanguageModelV3;
  /** Pre-resolved text embedding model for vector search */
  textEmbeddingModel?: unknown;
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

  // Add human input enforcement and disambiguation rules for agents with request_human_input tool
  if (opts.convexToolNames?.includes('request_human_input')) {
    suffixParts.push(`
**HUMAN INPUT RULE**
When you need ANY information, confirmation, or decision from the user:
- You MUST use the request_human_input tool to create an interactive input card
- NEVER ask questions as plain text in your response — the user cannot reply to text
- The ONLY way to collect user input is through the request_human_input tool
- This applies to: clarifications, missing values, confirmations, preferences, follow-up questions

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

  // Prefer inline output over file generation when file tools are available
  const FILE_GENERATION_TOOLS = new Set<ToolName>([
    'text',
    'docx',
    'pdf',
    'excel',
    'image',
  ]);
  if (opts.convexToolNames?.some((name) => FILE_GENERATION_TOOLS.has(name))) {
    suffixParts.push(
      `**INLINE OUTPUT PREFERENCE**
When the user asks you to create, write, or generate content (e.g. code, markdown, HTML, SVG, Mermaid diagrams, slides, documents):
- ALWAYS output the content directly in the chat as a fenced code block with the appropriate language tag (e.g. \\\`\\\`\\\`html, \\\`\\\`\\\`mermaid, \\\`\\\`\\\`markdown, \\\`\\\`\\\`svg, etc.)
- The chat supports a Canvas preview pane that can render HTML, SVG, Mermaid, and Markdown directly from code blocks — no file download needed
- Only use file generation tools (text, docx, pdf, excel, image) when the user EXPLICITLY asks to download, export, or save as a file
- For presentations: output the HTML slide deck as a code block — the Canvas preview pane renders it directly`,
    );
  }

  // Add approval card placement rule for agents with tools that create approval cards
  if (
    opts.convexToolNames?.some((name) =>
      [
        'run_workflow',
        'create_workflow',
        'save_workflow_definition',
        'update_workflow_step',
        'integration',
        'document_write',
      ].includes(name),
    ) ||
    opts.extraTools
  ) {
    suffixParts.push(
      'When a tool creates an approval card, do NOT mention its position in the chat. Never say the card is "above" or "below" — just inform the user that the card has been created.',
    );
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

  // Call settings are intentionally empty
  // temperature and frequencyPenalty are not supported by reasoning models (e.g., DeepSeek V3.2)
  // and cause empty responses when set. Let the model use its defaults.
  const callSettings: Record<string, number> = {};

  // Default maxSteps to 40 when tools are configured but maxSteps is not set.
  // Without maxSteps, AI SDK defaults to stepCountIs(1), which prevents tool call loops
  // and can cause models to "simulate" tool calls as XML text output.
  const effectiveMaxSteps =
    hasAnyTools && typeof opts.maxSteps !== 'number' ? 40 : opts.maxSteps;

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Agent config is dynamically assembled from heterogeneous tool sources (createTool results, integration-bound tools); the ToolSet branded type cannot be satisfied statically
  return {
    name: opts.name,
    instructions: finalInstructions,
    languageModel: opts.languageModel,
    callSettings,
    ...(typeof opts.maxTokens === 'number'
      ? { maxOutputTokens: opts.maxTokens }
      : {
          // Set default maxOutputTokens via providerOptions to prevent OpenRouter
          // from applying its own low defaults, which causes response truncation.
          // Mirrors the pattern used in summarize_context.ts and vision_agent.ts.
          providerOptions: { openai: { maxOutputTokens: 8192 } },
        }),
    ...(hasAnyTools ? { tools: mergedTools } : {}),
    ...(typeof effectiveMaxSteps === 'number'
      ? { maxSteps: effectiveMaxSteps }
      : {}),
    ...(opts.textEmbeddingModel
      ? { embeddingModel: opts.textEmbeddingModel }
      : {}),
  } as ConstructorParameters<typeof Agent>[1];
}
