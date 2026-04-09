/**
 * Convert OpenAI-format tool definitions to AI SDK tool format.
 *
 * Tools are created WITHOUT execute functions so the AI SDK returns
 * tool_calls to the caller instead of auto-executing them.
 */

import { jsonSchema } from 'ai';

interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Convert an array of OpenAI-format tool definitions to an AI SDK ToolSet.
 *
 * The resulting tools have NO execute function, which causes the AI SDK
 * to return `finishReason: "tool-calls"` instead of auto-executing.
 */
export function convertOpenAITools(
  openaiTools: OpenAIFunctionTool[],
): Record<
  string,
  { description: string; parameters: ReturnType<typeof jsonSchema> }
> {
  const toolSet: Record<
    string,
    { description: string; parameters: ReturnType<typeof jsonSchema> }
  > = {};

  for (const t of openaiTools) {
    if (t.type !== 'function' || !t.function?.name) continue;

    const fn = t.function;
    toolSet[fn.name] = {
      description: fn.description ?? '',
      parameters: jsonSchema(
        fn.parameters ?? { type: 'object', properties: {} },
      ),
    };
  }

  return toolSet;
}

/**
 * Generate a unique tool call ID in OpenAI format.
 */
export function generateToolCallId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'call_';
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
