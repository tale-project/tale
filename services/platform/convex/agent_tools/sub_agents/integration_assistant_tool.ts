/**
 * Integration Assistant Tool
 *
 * Delegates integration-related tasks to the specialized Integration Assistant Agent.
 * Isolates large database results from the main chat agent's context.
 * Requires admin/developer role for write operations.
 *
 * Uses the shared context management module for:
 * - Structured prompt building
 * - Smart history filtering via contextHandler
 * - Token-aware context management
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createIntegrationAgent } from '../../lib/create_integration_agent';
import { internal } from '../../_generated/api';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { formatIntegrationsForContext } from './helpers/format_integrations';
import { buildSubAgentPrompt } from './helpers/build_sub_agent_prompt';
import { createContextHandler, AGENT_CONTEXT_CONFIGS } from '../../lib/context_management';

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

      // Sub-thread creation and role check requires both threadId and userId
      if (!threadId || !userId) {
        return {
          success: false,
          response: '',
          error: 'Both threadId and userId are required for integration_assistant',
        };
      }

      // Check user role - only admin and developer can use this tool
      const userRole = await ctx.runQuery(internal.queries.member.getMemberRoleInternal, {
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
        const integrationsList = await ctx.runQuery(internal.integrations.queries.list_internal.listInternal, {
          organizationId,
        });
        const integrationsInfo = formatIntegrationsForContext(integrationsList);

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'integration_assistant',
            userId,
          },
        );

        console.log('[integration_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');
        console.log('[integration_assistant_tool] Parent thread for approvals:', threadId);

        // Build structured prompt using the shared context management module
        const additionalContext: Record<string, string> = {};
        if (args.integrationName) {
          additionalContext.target_integration = args.integrationName;
        }
        if (args.operation) {
          additionalContext.requested_operation = args.operation;
        }
        if (integrationsInfo) {
          additionalContext.available_integrations = integrationsInfo;
        }

        const promptResult = buildSubAgentPrompt({
          userRequest: args.userRequest,
          agentType: 'integration',
          threadId: subThreadId,
          organizationId,
          userId,
          parentThreadId: threadId,
          additionalContext,
        });

        console.log('[integration_assistant_tool] Calling integrationAgent.generateText', {
          integrationsCount: integrationsList.length,
          estimatedTokens: promptResult.estimatedTokens,
        });

        // Create context handler with integration agent configuration
        const integrationConfig = AGENT_CONTEXT_CONFIGS.integration;
        const contextHandler = createContextHandler({
          modelContextLimit: integrationConfig.modelContextLimit,
          outputReserve: integrationConfig.outputReserve,
          minRecentMessages: Math.min(4, integrationConfig.recentMessages),
        });

        // Extend context with parentThreadId for approval card linking
        const contextWithParentThread = {
          ...ctx,
          parentThreadId: threadId,
        };

        const generationStartTime = Date.now();
        const result = await integrationAgent.generateText(
          contextWithParentThread,
          { threadId: subThreadId, userId },
          {
            prompt: promptResult.prompt,
            messages: promptResult.systemMessages,
          },
          {
            contextOptions: {
              recentMessages: integrationConfig.recentMessages,
              excludeToolMessages: false,
            },
            contextHandler,
          },
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
