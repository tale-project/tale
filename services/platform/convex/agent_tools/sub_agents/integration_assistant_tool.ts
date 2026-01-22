/**
 * Integration Assistant Tool
 *
 * Delegates integration-related tasks to the specialized Integration Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 *
 * Requires admin/developer role for access.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { formatIntegrationsForContext } from './helpers/format_integrations';
import {
  getGetMemberRoleInternalRef,
  getListIntegrationsInternalRef,
  getIntegrationAgentGenerateResponseRef,
} from '../../lib/function_refs';

const ALLOWED_ROLES = ['admin', 'developer'] as const;

export const integrationAssistantTool = {
  name: 'integration_assistant' as const,
  tool: createTool({
    description: `Delegate integration-related tasks to the specialized Integration Agent.

Use this tool for ANY integration-related request, including:
- Discovering available integrations and their operations
- Querying external systems (REST APIs, SQL databases)
- Executing write operations (with approval workflow)
- Managing approval workflows for data modifications

The Integration Agent is specialized in:
- Integration introspection (discovering available operations)
- Executing read operations on external systems
- Managing write operation approvals
- Pre-validation before write operations

IMPORTANT: This tool is restricted to admin and developer roles only.
Write operations require user approval before execution.

Simply describe what you need to do with the external integration.

EXAMPLES:
• Discover: { userRequest: "What operations are available for shopify_store?" }
• Read: { userRequest: "Get all orders from last week", integrationName: "shopify_store" }
• Write: { userRequest: "Update guest email to john@example.com", integrationName: "protel_pms", operation: "update_guest" }`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's integration-related request in natural language"),
      integrationName: z
        .string()
        .optional()
        .describe('Name of the integration to use (if known)'),
      operation: z
        .string()
        .optional()
        .describe('Specific operation to execute (if known)'),
    }),

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      response: string;
      approvalCreated?: boolean;
      approvalId?: string;
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

      if (!threadId || !userId) {
        return {
          success: false,
          response: '',
          error: 'Both threadId and userId are required for integration_assistant',
        };
      }

      // Check user role - only admin and developer can use this tool
      const userRole = await ctx.runQuery(
        getGetMemberRoleInternalRef(),
        { userId, organizationId },
      );

      const normalizedRole = (userRole ?? 'member').toLowerCase();
      if (!ALLOWED_ROLES.includes(normalizedRole as (typeof ALLOWED_ROLES)[number])) {
        console.log('[integration_assistant_tool] Access denied for role:', normalizedRole);
        return {
          success: false,
          response: '',
          error: `Access denied: The integration assistant is only available to users with admin or developer roles. Your current role is "${normalizedRole}".`,
        };
      }

      try {
        // Load available integrations for this organization
        const integrationsList = await ctx.runQuery(
          getListIntegrationsInternalRef(),
          { organizationId },
        );
        const integrationsInfo = formatIntegrationsForContext(integrationsList);

        // Get or create a sub-thread for this parent thread + agent combination
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'integration_assistant',
            userId,
          },
        );

        console.log(
          '[integration_assistant_tool] Sub-thread:',
          subThreadId,
          isNew ? '(new)' : '(reused)',
        );
        console.log('[integration_assistant_tool] Parent thread for approvals:', threadId);

        // Build additional context for the agent
        const additionalContext: Record<string, string> = {};
        if (args.integrationName) {
          additionalContext.target_integration = args.integrationName;
        }
        if (args.operation) {
          additionalContext.target_operation = args.operation;
        }

        // Call the Integration Agent via Convex API - all context management happens inside
        const result = await ctx.runAction(
          getIntegrationAgentGenerateResponseRef(),
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
            integrationsInfo,
          },
        );

        // Check if an approval was created (look for approval patterns in response)
        const approvalMatch = result.text.match(
          /approval[^\w]*(?:ID|id)[^\w]*[:\s]*["']?([a-zA-Z0-9]+)["']?/i,
        );
        const hasApproval =
          result.text.toLowerCase().includes('approval') &&
          (result.text.toLowerCase().includes('created') ||
            result.text.toLowerCase().includes('pending'));

        // Check if a human input request was created (waiting for user selection)
        const hasHumanInputRequest =
          result.text.toLowerCase().includes('input card') ||
          result.text.toLowerCase().includes('waiting for') ||
          result.text.toLowerCase().includes('select') ||
          result.text.toLowerCase().includes('request_human_input');

        // If waiting for human input, prepend a clear signal to the response
        let finalResponse = result.text;
        if (hasHumanInputRequest && !hasApproval) {
          finalResponse = `[HUMAN INPUT CARD CREATED - DO NOT FABRICATE OPTIONS]\n\n${result.text}`;
        }

        return {
          success: true,
          response: finalResponse,
          approvalCreated: hasApproval,
          approvalId: approvalMatch?.[1],
          usage: result.usage,
        };
      } catch (error) {
        console.error('[integration_assistant_tool] Error:', error);
        return {
          success: false,
          response: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
