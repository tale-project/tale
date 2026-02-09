/**
 * Integration Assistant Tool
 *
 * Delegates integration-related tasks to the specialized Integration Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 *
 * Requires admin/developer role for access.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { buildAdditionalContext } from './helpers/build_additional_context';
import { checkRoleAccess } from './helpers/check_role_access';
import { formatIntegrationsForContext } from './helpers/format_integrations';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import {
  handleToolError,
  type ToolResponseWithApproval,
} from './helpers/tool_response';
import { validateToolContext } from './helpers/validate_context';

const INTEGRATION_CONTEXT_MAPPING = {
  integrationName: 'target_integration',
  operation: 'target_operation',
} as const;

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

    handler: async (ctx: ToolCtx, args): Promise<ToolResponseWithApproval> => {
      const validation = validateToolContext(ctx, 'integration_assistant', {
        requireUserId: true,
      });
      if (!validation.valid) return validation.error;

      const { organizationId, threadId, userId } = validation.context;

      if (!userId) {
        return {
          success: false,
          response: 'integration_assistant requires a userId',
        };
      }

      const roleCheck = await checkRoleAccess(
        ctx,
        userId,
        organizationId,
        'integration_assistant',
      );
      if (!roleCheck.allowed)
        return roleCheck.error ?? { success: false, response: 'Access denied' };

      try {
        const integrationsList = await ctx.runQuery(
          internal.integrations.internal_queries.listInternal,
          { organizationId },
        );
        const integrationsInfo = formatIntegrationsForContext(integrationsList);

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
        console.log(
          '[integration_assistant_tool] Parent thread for approvals:',
          threadId,
        );

        const result = await ctx.runAction(
          internal.agents.integration.internal_actions.generateResponse,
          {
            threadId: subThreadId,
            userId,
            organizationId,
            promptMessage: args.userRequest,
            additionalContext: buildAdditionalContext(
              args,
              INTEGRATION_CONTEXT_MAPPING,
            ),
            parentThreadId: threadId,
            integrationsInfo,
          },
        );

        const approvalMatch = result.text.match(
          /approval[^\w]*(?:ID|id)[^\w]*[:\s]*["']?([a-zA-Z0-9]+)["']?/i,
        );
        const hasApproval =
          result.text.toLowerCase().includes('approval') &&
          (result.text.toLowerCase().includes('created') ||
            result.text.toLowerCase().includes('pending'));

        // Detect human input request using specific markers to avoid false positives
        // - request_human_input: the tool name used by the agent
        // - HUMAN_INPUT_REQUESTED: marker that can be added to agent instructions
        const lowerText = result.text.toLowerCase();
        const hasHumanInputRequest =
          lowerText.includes('request_human_input') ||
          result.text.includes('[HUMAN_INPUT_REQUESTED]');

        let finalResponse = result.text;
        if (hasHumanInputRequest && !hasApproval) {
          finalResponse = `[HUMAN INPUT CARD CREATED - DO NOT FABRICATE OPTIONS]\n\n${result.text}`;
        }

        return {
          success: true,
          response: finalResponse,
          approvalCreated: hasApproval,
          approvalId: approvalMatch?.[1],
          usage: {
            ...result.usage,
            durationSeconds:
              result.durationMs !== undefined
                ? result.durationMs / 1000
                : undefined,
          },
          model: result.model,
          provider: result.provider,
          input: args.userRequest,
          output: finalResponse,
        };
      } catch (error) {
        return handleToolError('integration_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
