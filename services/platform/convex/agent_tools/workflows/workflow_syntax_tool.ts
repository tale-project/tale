/**
 * Convex Tool: Workflow Syntax Reference
 *
 * Read-only access to workflow step syntax by category.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { getAllSyntax, getSyntaxReference } from './helpers/syntax_reference';

const workflowSyntaxArgs = z.object({
  category: z
    .enum([
      'start',
      'llm',
      'action',
      'condition',
      'loop',
      'output',
      'workflow_config',
      'variables',
    ])
    .optional()
    .describe(
      "Category of syntax to retrieve. Omit to get all categories. Options: 'start', 'llm', 'action', 'condition', 'loop', 'output', 'workflow_config', 'variables'.",
    ),
});

export const workflowSyntaxTool: ToolDefinition = {
  name: 'workflow_syntax',
  tool: createTool({
    description: `Access workflow syntax reference. Omit category to get all syntax at once.

**SYNTAX CATEGORIES:**
• 'start': Start step config (workflow entry point with optional inputSchema)
• 'llm': LLM step config (requires name + systemPrompt)
• 'action': Action types (workflow_processing_records, customer, conversation, approval, set_variables, integration)
• 'condition': JEXL condition expressions
• 'loop': Loop step for iteration
• 'output': Output step config (workflow output via outputMapping)
• 'workflow_config': Workflow-level config (timeout, retryPolicy, variables)
• 'variables': Variable syntax and JEXL filters`,
    args: workflowSyntaxArgs,
    handler: async (_ctx, args) => {
      if (!args.category) {
        return getAllSyntax();
      }
      return getSyntaxReference({ category: args.category });
    },
  }),
} as const;
