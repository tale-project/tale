/**
 * Dynamic JSON Output Tool
 *
 * Creates a tool that captures structured JSON output from the agent.
 * This is used as a workaround for generateObject not supporting tools.
 *
 * The pattern: model the desired output as the tool's arguments, then
 * use generateText with this tool. The agent calls the tool with the
 * structured data, which we capture and return.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';
import type { JsonSchemaDefinition } from '../workflow_engine/types/nodes';

/**
 * Result from creating a json_output tool
 */
export interface JsonOutputToolResult {
  /** The tool to add to the agent's tools */
   
  tool: ReturnType<typeof createTool<any, string>>;
  /** Function to get the captured output (returns null if not called) */
  getCapturedOutput: () => unknown;
  /** Function to check if the tool was called */
  wasCalled: () => boolean;
}

/**
 * Creates a dynamic json_output tool from a JSON Schema.
 *
 * The tool captures the structured output when called by the agent.
 * Use `getCapturedOutput()` after agent execution to retrieve the result.
 *
 * @param outputSchema - JSON Schema defining the expected output structure
 * @returns Object containing the tool and accessor functions
 */
export function createJsonOutputTool(
  outputSchema: JsonSchemaDefinition,
): JsonOutputToolResult {
  // Convert JSON Schema to Zod schema using native Zod 4 API
  const zodSchema = z.fromJSONSchema(outputSchema);

  // Closure to capture the output
  let capturedOutput: unknown = null;
  let called = false;

  // Build description from schema
  const schemaDescription = outputSchema.description
    ? `\n\nExpected output: ${outputSchema.description}`
    : '';

  const tool = createTool({
    description: `Submit the final structured JSON output.${schemaDescription}

IMPORTANT: You MUST call this tool to complete the task. After gathering all necessary information using other tools, call this tool with your final structured result. Do not respond with plain text - always use this tool to provide your answer.`,
    args: zodSchema,
    handler: async (_ctx, args) => {
      capturedOutput = args;
      called = true;
      return 'Output captured successfully. Task complete.';
    },
  });

  return {
    tool,
    getCapturedOutput: () => capturedOutput,
    wasCalled: () => called,
  };
}

