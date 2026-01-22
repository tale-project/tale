/**
 * CRM Assistant Tool
 *
 * Delegates CRM-related tasks to the specialized CRM Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { getCrmAgentGenerateResponseRef } from '../../lib/function_refs';

export const crmAssistantTool = {
  name: 'crm_assistant' as const,
  tool: createTool({
    description: `Delegate CRM-related tasks to the specialized CRM Agent.

Use this tool for ANY CRM data request, including:
- Retrieving customer information (by ID, email, or listing)
- Searching and filtering customers
- Retrieving product information (by ID or listing)
- Browsing the product catalog
- Aggregating CRM data (counting, summarizing)

The CRM Agent is specialized in:
- Efficient data retrieval with field selection
- Pagination handling for large datasets
- Customer and product search operations
- Data aggregation and analysis

SCOPE LIMITATION:
This tool ONLY accesses the INTERNAL CRM database.
DO NOT use this tool for data from external systems - check [INTEGRATIONS] context and use integration_assistant instead.

Simply describe what CRM data you need.

EXAMPLES:
- Customer lookup: { userRequest: "Find customer with email john@example.com" }
- Customer list: { userRequest: "List all active customers", operation: "list_customers" }
- Product search: { userRequest: "Show me all products in the Electronics category" }
- Data analysis: { userRequest: "How many customers do we have by status?" }`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's CRM-related request in natural language"),
      customerId: z
        .string()
        .optional()
        .describe('Specific customer ID if looking up a known customer'),
      customerEmail: z
        .string()
        .optional()
        .describe('Customer email address for email-based lookup'),
      productId: z
        .string()
        .optional()
        .describe('Specific product ID if looking up a known product'),
      operation: z
        .enum(['get_customer', 'list_customers', 'get_product', 'list_products'])
        .optional()
        .describe('Hint about the operation type (optional, agent will infer)'),
    }),

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      response: string;
      error?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }> => {
      const { organizationId, threadId, userId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          response: '',
          error: 'organizationId is required',
        };
      }

      if (!threadId) {
        return {
          success: false,
          response: '',
          error: 'threadId is required for crm_assistant to create sub-threads',
        };
      }

      try {
        // Get or create a sub-thread for this parent thread + agent combination
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'crm_assistant',
            userId,
          },
        );

        console.log(
          '[crm_assistant_tool] Sub-thread:',
          subThreadId,
          isNew ? '(new)' : '(reused)',
        );

        // Build additional context for the agent
        const additionalContext: Record<string, string> = {};
        if (args.customerId) {
          additionalContext.customer_id = args.customerId;
        }
        if (args.customerEmail) {
          additionalContext.customer_email = args.customerEmail;
        }
        if (args.productId) {
          additionalContext.product_id = args.productId;
        }
        if (args.operation) {
          additionalContext.operation_hint = args.operation;
        }

        // Call the CRM Agent via Convex API - all context management happens inside
        const result = await ctx.runAction(
          getCrmAgentGenerateResponseRef(),
          {
            threadId: subThreadId,
            userId,
            organizationId,
            taskDescription: args.userRequest,
            additionalContext:
              Object.keys(additionalContext).length > 0
                ? additionalContext
                : undefined,
            parentThreadId: threadId,
          },
        );

        return {
          success: true,
          response: result.text,
          usage: result.usage,
        };
      } catch (error) {
        console.error('[crm_assistant_tool] Error:', error);
        return {
          success: false,
          response: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
