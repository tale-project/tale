/**
 * Convex Tool: Workflow Examples
 *
 * Read-only access to predefined workflow examples.
 * Supports:
 * - operation = 'list_predefined': list all predefined workflow names with descriptions
 * - operation = 'get_predefined': get the full definition of a specific predefined workflow
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';

import {
  listPredefinedWorkflows,
  getPredefinedWorkflow,
  type WorkflowReadListPredefinedResult,
  type WorkflowReadGetPredefinedResult,
} from './helpers/read_predefined_workflows';

const workflowExamplesArgs = z.object({
  operation: z
    .enum(['list_predefined', 'get_predefined'])
    .describe(
      "Operation to perform: 'list_predefined' to list all predefined workflows, 'get_predefined' to get a specific workflow definition",
    ),
  // For get_predefined operation
  workflowKey: z
    .string()
    .optional()
    .describe(
      "Required for 'get_predefined': The workflow key (e.g., 'shopifySyncProducts', 'emailSyncImap', 'generalProductRecommendation'). Use list_predefined to see available keys.",
    ),
});

export const workflowExamplesTool: ToolDefinition = {
  name: 'workflow_examples',
  tool: createTool({
    description: `Access predefined workflow examples to learn patterns and copy configurations.

OPERATIONS:
• 'list_predefined': List all predefined workflow templates with their names, descriptions, and step counts. Use this to discover available examples.
• 'get_predefined': Get the complete definition of a specific predefined workflow including all steps and configurations. Use this to study how workflows are structured and copy patterns.

WORKFLOW CATEGORIES:
• Data Sync: shopifySyncProducts, shopifySyncCustomers, circulySyncCustomers, circulySyncProducts, emailSyncImap, onedriveSync
• Business Logic: generalProductRecommendation, generalCustomerStatusAssessment, conversationAutoReply, productRecommendationEmail
• RAG Sync: documentRagSync, productRagSync, customerRagSync, workflowRagSync, websitePagesRagSync
• Website: websiteScan

BEST PRACTICES:
• Use 'list_predefined' first to see all available examples
• Use 'get_predefined' to study similar workflows before creating new ones
• Copy step configurations from predefined workflows to ensure correct structure`,
    args: workflowExamplesArgs,
    handler: async (
      _ctx,
      args,
    ): Promise<
      WorkflowReadListPredefinedResult | WorkflowReadGetPredefinedResult
    > => {
      if (args.operation === 'list_predefined') {
        return listPredefinedWorkflows();
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

