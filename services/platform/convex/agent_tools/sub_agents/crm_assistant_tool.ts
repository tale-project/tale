/**
 * CRM Assistant Tool
 *
 * Delegates CRM-related tasks to the specialized CRM Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { buildAdditionalContext } from './helpers/build_additional_context';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import {
  successResponse,
  handleToolError,
  type ToolResponse,
} from './helpers/tool_response';
import { validateToolContext } from './helpers/validate_context';

const CRM_CONTEXT_MAPPING = {
  customerId: 'customer_id',
  customerEmail: 'customer_email',
  productId: 'product_id',
  operation: 'operation_hint',
} as const;

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
        .enum([
          'get_customer',
          'list_customers',
          'get_product',
          'list_products',
        ])
        .optional()
        .describe('Hint about the operation type (optional, agent will infer)'),
    }),

    handler: async (ctx: ToolCtx, args): Promise<ToolResponse> => {
      const validation = validateToolContext(ctx, 'crm_assistant');
      if (!validation.valid) return validation.error;

      const { organizationId, threadId, userId } = validation.context;

      try {
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

        const result = await ctx.runAction(
          internal.agents.crm.internal_actions.generateResponse,
          {
            threadId: subThreadId,
            userId,
            organizationId,
            promptMessage: args.userRequest,
            additionalContext: buildAdditionalContext(
              args,
              CRM_CONTEXT_MAPPING,
            ),
            parentThreadId: threadId,
          },
        );

        return successResponse(
          result.text,
          {
            ...result.usage,
            durationSeconds:
              result.durationMs !== undefined
                ? result.durationMs / 1000
                : undefined,
          },
          result.model,
          result.provider,
          undefined,
          args.userRequest,
        );
      } catch (error) {
        return handleToolError('crm_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
