/**
 * Integration Assistant Tool
 *
 * Delegates integration-related tasks to the specialized Integration Assistant Agent.
 * Isolates large database results from the main chat agent's context.
 * Requires admin/developer role for write operations.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createIntegrationAgent } from '../../lib/create_integration_agent';
import { internal } from '../../_generated/api';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { formatIntegrationsForContext } from './helpers/format_integrations';

/** Roles that are allowed to use the integration assistant tool */
const ALLOWED_ROLES = ['admin', 'developer'] as const;

export const integrationAssistantTool = {
  name: 'integration_assistant' as const,
  tool: createTool({
    description: `Delegate integration-related tasks to the specialized Integration Assistant Agent.

Use this tool for ANY integration-related request, including:
- Discovering available integrations and their operations
- Querying external systems (REST APIs, SQL databases)
- Executing write operations (with approval workflow)
- Managing approval workflows for data modifications

The Integration Assistant is specialized in:
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

      // Role check requires userId - cannot verify role with only threadId
      if (!userId) {
        return {
          success: false,
          response: '',
          error: 'userId is required for integration_assistant to verify role permissions',
        };
      }

      // Check user role - only admin and developer can use this tool
      const userRole = await ctx.runQuery(internal.member.getMemberRoleInternal, {
        userId,
        organizationId,
      });

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
        const integrationAgent = createIntegrationAgent();

        // Load available integrations for this organization
        // This is critical - sub-agents need to know what integrations exist
        const integrationsList = await ctx.runQuery(internal.integrations.listInternal, {
          organizationId,
        });
        const integrationsInfo = formatIntegrationsForContext(integrationsList);

        // Build the prompt with context
        let prompt = `## User Request:\n${args.userRequest}\n\n`;
        if (args.integrationName) {
          prompt += `## Target Integration: ${args.integrationName}\n\n`;
        }
        if (args.operation) {
          prompt += `## Requested Operation: ${args.operation}\n\n`;
        }

        // Include available integrations in the prompt
        if (integrationsInfo) {
          prompt += `## Available Integrations:\n${integrationsInfo}\n\n`;
        }

        // Format current date/time clearly for the model
        const now = new Date();
        const currentDate = now.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const currentTime = now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        });

        prompt += `## Context:\n`;
        prompt += `- **Current Date**: ${currentDate}\n`;
        prompt += `- **Current Time**: ${currentTime}\n`;
        prompt += `- Organization ID: ${organizationId}\n`;
        if (threadId) {
          prompt += `- Parent Thread ID: ${threadId}\n`;
        }
        if (userId) {
          prompt += `- User ID: ${userId}\n`;
        }

        console.log('[integration_assistant_tool] Calling integrationAgent.generateText with', integrationsList.length, 'integrations');

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId!,
            subAgentType: 'integration_assistant',
            userId,
          },
        );

        console.log('[integration_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');
        console.log('[integration_assistant_tool] Parent thread for approvals:', threadId);

        // Extend context with parentThreadId for approval card linking
        const contextWithParentThread = {
          ...ctx,
          parentThreadId: threadId,
        };

        const generationStartTime = Date.now();
        const result = await integrationAgent.generateText(
          contextWithParentThread,
          { threadId: subThreadId, userId },
          { prompt },
        );
        const generationDurationMs = Date.now() - generationStartTime;

        console.log('[integration_assistant_tool] Result:', {
          durationMs: generationDurationMs,
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
          stepsCount: result.steps?.length ?? 0,
        });

        // Check if an approval was created (look for approval patterns in response)
        const approvalMatch = result.text.match(/approval[^\w]*(?:ID|id)[^\w]*[:\s]*["']?([a-zA-Z0-9]+)["']?/i);
        const hasApproval = result.text.toLowerCase().includes('approval') &&
                           (result.text.toLowerCase().includes('created') ||
                            result.text.toLowerCase().includes('pending'));

        return {
          success: true,
          response: result.text,
          approvalCreated: hasApproval,
          approvalId: approvalMatch?.[1],
          usage: result.usage ? {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          } : undefined,
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
