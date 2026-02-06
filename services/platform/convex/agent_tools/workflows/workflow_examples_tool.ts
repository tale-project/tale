/**
 * Convex Tool: Workflow Examples
 *
 * Read-only access to predefined workflow examples.
 * Supports:
 * - operation = 'list_predefined': list all predefined workflow names with descriptions
 * - operation = 'get_predefined': get the full definition of a specific predefined workflow
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';

import {
  listPredefinedWorkflows,
  getPredefinedWorkflow,
  type WorkflowReadGetPredefinedResult,
} from './helpers/read_predefined_workflows';
import { getSyntaxReference } from './helpers/syntax_reference';

const workflowExamplesArgs = z.object({
  operation: z
    .enum(['list_predefined', 'get_predefined', 'get_syntax_reference'])
    .describe(
      "Operation to perform: 'list_predefined' to list workflows, 'get_predefined' to get a workflow definition, 'get_syntax_reference' to get syntax documentation",
    ),
  // For get_predefined operation
  workflowKey: z
    .string()
    .optional()
    .describe(
      "Required for 'get_predefined': The workflow key (e.g., 'shopifySyncProducts', 'emailSyncImap', 'generalProductRecommendation'). Use list_predefined to see available keys.",
    ),
  // For get_syntax_reference operation
  category: z
    .enum([
      'quick_start',
      'common_patterns',
      'trigger',
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
      "For 'get_syntax_reference': Category of syntax to retrieve. START with 'quick_start' for decision tree, then 'common_patterns' for skeletons. Other options: 'trigger', 'llm', 'action', 'condition', 'loop', 'email', 'entity_processing', 'variables'.",
    ),
});

export const workflowExamplesTool: ToolDefinition = {
  name: 'workflow_examples',
  tool: createTool({
    description: `Access workflow syntax reference and predefined examples.

**⭐ RECOMMENDED WORKFLOW FOR CREATING NEW WORKFLOWS:**
1. FIRST: get_syntax_reference(category='quick_start') - Get decision tree and avoid common mistakes
2. THEN: get_syntax_reference(category='common_patterns') - Get skeleton configs for your pattern
3. OPTIONALLY: get_predefined(workflowKey='...') - Study a similar complete workflow
4. FINALLY: Create workflow using the patterns learned

**OPERATIONS:**
• 'get_syntax_reference': Get syntax by category (START HERE)
• 'list_predefined': List all workflow templates with descriptions
• 'get_predefined': Get complete workflow definition to study

**SYNTAX CATEGORIES (for get_syntax_reference):**
• ⭐ 'quick_start': Decision tree, common mistakes, step type reference
• ⭐ 'common_patterns': Pattern skeletons (Entity Processing, Email, LLM Analysis, Data Sync, RAG)
• 'trigger': Start/Trigger step config (manual, scheduled, webhook) - use 'start' for new workflows
• 'llm': LLM step config (requires name + systemPrompt)
• 'action': Action types (workflow_processing_records, customer, approval, etc.)
• 'condition': JEXL condition expressions
• 'loop': Loop step for iteration (data sync, NOT entity processing)
• 'email': Email sending pattern (conversation + approval)
• 'entity_processing': One-at-a-time processing pattern
• 'variables': Variable syntax and JEXL filters

**PREDEFINED WORKFLOW CATEGORIES:**
• Entity Processing: generalCustomerStatusAssessment, productRecommendationEmail, conversationAutoReply
• Data Sync: shopifySyncProducts, shopifySyncCustomers, emailSyncImap, onedriveSync
• RAG Sync: documentRagSync, productRagSync, customerRagSync
• LLM Analysis: generalProductRecommendation, productRelationshipAnalysis`,
    args: workflowExamplesArgs,
    handler: async (_ctx, args) => {
      if (args.operation === 'list_predefined') {
        return listPredefinedWorkflows();
      }

      if (args.operation === 'get_syntax_reference') {
        if (!args.category) {
          return {
            operation: 'get_syntax_reference',
            found: false,
            syntax:
              "Missing required 'category'. START with 'quick_start' for decision tree, then 'common_patterns' for skeletons. Other options: trigger, llm, action, condition, loop, email, entity_processing, variables.",
          };
        }
        return getSyntaxReference({ category: args.category });
      }

      // operation === 'get_predefined'
      if (!args.workflowKey) {
        return {
          operation: 'get_predefined',
          found: false,
          message:
            "Missing required 'workflowKey' for get_predefined operation. Use list_predefined to see available keys.",
        } as WorkflowReadGetPredefinedResult;
      }
      return getPredefinedWorkflow({ workflowKey: args.workflowKey });
    },
  }),
} as const;

