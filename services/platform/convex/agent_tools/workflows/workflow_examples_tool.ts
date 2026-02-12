/**
 * Convex Tool: Workflow Examples
 *
 * Read-only access to workflow syntax reference.
 * Supports:
 * - operation = 'get_syntax_reference': get syntax documentation by category
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { getSyntaxReference } from './helpers/syntax_reference';

const workflowExamplesArgs = z.object({
  operation: z
    .literal('get_syntax_reference')
    .describe(
      "Operation to perform: 'get_syntax_reference' to get syntax documentation",
    ),
  category: z
    .enum([
      'quick_start',
      'common_patterns',
      'start',
      'llm',
      'action',
      'condition',
      'loop',
      'email',
      'entity_processing',
      'variables',
    ])
    .optional()
    .describe(
      "Category of syntax to retrieve. START with 'quick_start' for decision tree, then 'common_patterns' for skeletons. Other options: 'start', 'llm', 'action', 'condition', 'loop', 'email', 'entity_processing', 'variables'.",
    ),
});

export const workflowExamplesTool: ToolDefinition = {
  name: 'workflow_examples',
  tool: createTool({
    description: `Access workflow syntax reference.

**⭐ RECOMMENDED WORKFLOW FOR CREATING NEW WORKFLOWS:**
1. FIRST: get_syntax_reference(category='quick_start') - Get decision tree and avoid common mistakes
2. THEN: get_syntax_reference(category='common_patterns') - Get skeleton configs for your pattern
3. FINALLY: Create workflow using the patterns learned

**SYNTAX CATEGORIES:**
• ⭐ 'quick_start': Decision tree, common mistakes, step type reference
• ⭐ 'common_patterns': Pattern skeletons (Entity Processing, Email, LLM Analysis, Data Sync, RAG)
• 'start': Start step config (workflow entry point with optional inputSchema)
• 'llm': LLM step config (requires name + systemPrompt)
• 'action': Action types (workflow_processing_records, customer, approval, etc.)
• 'condition': JEXL condition expressions
• 'loop': Loop step for iteration (data sync, NOT entity processing)
• 'email': Email sending pattern (conversation + approval)
• 'entity_processing': One-at-a-time processing pattern
• 'variables': Variable syntax and JEXL filters`,
    args: workflowExamplesArgs,
    handler: async (_ctx, args) => {
      if (!args.category) {
        return {
          operation: 'get_syntax_reference',
          found: false,
          syntax:
            "Missing required 'category'. START with 'quick_start' for decision tree, then 'common_patterns' for skeletons. Other options: start, llm, action, condition, loop, email, entity_processing, variables.",
        };
      }
      return getSyntaxReference({ category: args.category });
    },
  }),
} as const;
