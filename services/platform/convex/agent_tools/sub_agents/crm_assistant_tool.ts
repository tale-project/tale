/**
 * CRM Assistant Tool
 *
 * Delegates CRM-related tasks to the specialized CRM Assistant Agent.
 * Isolates potentially large customer/product data from the main chat agent's context.
 *
 * Uses the shared context management module for:
 * - Structured prompt building
 * - Smart history filtering via contextHandler
 * - Token-aware context management
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createCrmAgent } from '../../lib/create_crm_agent';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { buildSubAgentPrompt } from './helpers/build_sub_agent_prompt';
import { createContextHandler, AGENT_CONTEXT_CONFIGS } from '../../lib/context_management';

export const crmAssistantTool = {
  name: 'crm_assistant' as const,
  tool: createTool({
    description: `Delegate CRM-related tasks to the specialized CRM Assistant Agent.

Use this tool for ANY CRM data request, including:
- Retrieving customer information (by ID, email, or listing)
- Searching and filtering customers
- Retrieving product information (by ID or listing)
- Browsing the product catalog
- Aggregating CRM data (counting, summarizing)

The CRM Assistant is specialized in:
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

      // Sub-thread creation requires both threadId and userId
      if (!threadId || !userId) {
        return {
          success: false,
          response: '',
          error: 'Both threadId and userId are required for crm_assistant',
        };
      }

      try {
        const crmAgent = createCrmAgent();

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'crm_assistant',
            userId,
          },
        );

        console.log('[crm_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');

        // Build structured prompt using the shared context management module
        const additionalContext: Record<string, string> = {};
        if (args.customerId) {
          additionalContext.target_customer_id = args.customerId;
        }
        if (args.customerEmail) {
          additionalContext.target_customer_email = args.customerEmail;
        }
        if (args.productId) {
          additionalContext.target_product_id = args.productId;
        }
        if (args.operation) {
          additionalContext.requested_operation = args.operation;
        }

        const promptResult = buildSubAgentPrompt({
          userRequest: args.userRequest,
          agentType: 'crm',
          threadId: subThreadId,
          organizationId,
          userId,
          parentThreadId: threadId,
          additionalContext,
        });

        console.log('[crm_assistant_tool] Calling crmAgent.generateText', {
          estimatedTokens: promptResult.estimatedTokens,
        });

        // Create context handler with CRM agent configuration
        const crmConfig = AGENT_CONTEXT_CONFIGS.crm;
        const contextHandler = createContextHandler({
          modelContextLimit: crmConfig.modelContextLimit,
          outputReserve: crmConfig.outputReserve,
          minRecentMessages: Math.min(4, crmConfig.recentMessages),
        });

        // Extend context with parentThreadId for human input card linking
        const contextWithParentThread = {
          ...ctx,
          parentThreadId: threadId,
        };

        const generationStartTime = Date.now();
        const result = await crmAgent.generateText(
          contextWithParentThread,
          { threadId: subThreadId, userId },
          {
            prompt: promptResult.prompt,
            messages: promptResult.systemMessages,
          },
          {
            contextOptions: {
              recentMessages: crmConfig.recentMessages,
              excludeToolMessages: false,
            },
            contextHandler,
          },
        );
        const generationDurationMs = Date.now() - generationStartTime;

        console.log('[crm_assistant_tool] Result:', {
          durationMs: generationDurationMs,
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
          stepsCount: result.steps?.length ?? 0,
        });

        // Check if a human input request was created (waiting for user selection)
        const hasHumanInputRequest = result.text.toLowerCase().includes('input card') ||
                                     result.text.toLowerCase().includes('waiting for') ||
                                     result.text.toLowerCase().includes('select') ||
                                     result.text.toLowerCase().includes('request_human_input');

        // If waiting for human input, prepend a clear signal to the response
        let finalResponse = result.text;
        if (hasHumanInputRequest) {
          finalResponse = `[HUMAN INPUT CARD CREATED - DO NOT FABRICATE OPTIONS]\n\n${result.text}`;
        }

        return {
          success: true,
          response: finalResponse,
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
