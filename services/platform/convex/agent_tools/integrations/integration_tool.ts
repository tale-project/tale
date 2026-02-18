/**
 * Convex Tool: Integration
 *
 * Unified tool for executing operations on configured integrations.
 * Supports both REST API and SQL integrations without hardcoding.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import type { IntegrationExecutionResult } from './types';

import { getBoolean, isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

const integrationArgs = z.object({
  integrationName: z
    .string()
    .describe('Integration name (e.g., "protel", "stripe")'),
  operation: z
    .string()
    .describe(
      'Operation name to execute (e.g., "create_guest", "get_reservations")',
    ),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Operation parameters as a JSON object with key-value pairs. ' +
        'Example: { "guestId": 5000003, "lastName": "Zhang", "firstName": "Mike" }. ' +
        'IMPORTANT: You MUST include all required parameters from integration_introspect. ' +
        'Do NOT pass an empty object {} if the operation requires parameters.',
    ),
});

export const integrationTool: ToolDefinition = {
  name: 'integration',
  tool: createTool({
    description: `Execute a single operation on an integration.

CRITICAL: The "params" field must contain ALL required parameters as a JSON object.
Example call: { integrationName: "protel", operation: "create_guest", params: { "guestId": 5000003, "lastName": "Zhang" } }

Steps:
1. First call integration_introspect(operation="xxx") to get required parameters
2. Then call this tool with ALL required params filled in

Write operations create approval cards. Use integration_batch for multiple parallel reads.`,

    args: integrationArgs,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<IntegrationExecutionResult> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      // Look up parent thread from thread summary (stable, database-backed)
      // This ensures approvals from sub-agents link to the main chat thread
      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      console.log('[integration_tool] Context:', {
        threadId,
        currentThreadId,
        messageId,
      });

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to execute integrations',
        );
      }

      try {
        // Delegate to the existing integration action logic via internal action wrapper
        // This reuses all validation, credential decryption, and execution logic
        const result = await ctx.runAction(
          internal.agent_tools.integrations.internal_actions.executeIntegration,
          {
            organizationId,
            integrationName: args.integrationName,
            operation: args.operation,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod-validated params is Record<string, unknown>; narrowing to primitive values for Convex serialization
            params: (args.params || {}) as Record<
              string,
              string | number | boolean | null
            >,
            threadId: threadId, // Pass threadId for approval card linking
            messageId: messageId, // Pass messageId for approval card linking to the current message
          },
        );

        // Check if approval is required (write operation)
        interface ApprovalResult {
          requiresApproval: true;
          approvalId: string;
          operationName: string;
          operationTitle: string;
          operationType: 'read' | 'write';
          parameters: Record<string, unknown>;
        }

        const isApprovalResult = (r: unknown): r is ApprovalResult =>
          isRecord(r) && getBoolean(r, 'requiresApproval') === true;

        if (isApprovalResult(result)) {
          const approvalResult = result;
          console.log('[integration_tool] Approval created successfully:', {
            approvalId: approvalResult.approvalId,
            operation: args.operation,
            integration: args.integrationName,
          });

          return {
            success: true,
            integration: args.integrationName,
            operation: args.operation,
            requiresApproval: true,
            approvalId: approvalResult.approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalResult.approvalId}) has been created for "${approvalResult.operationTitle || args.operation}" on ${args.integrationName}. The user must approve or reject this operation in the chat UI before it will be executed.`,
            data: {
              approvalId: approvalResult.approvalId,
              operationName: approvalResult.operationName,
              operationTitle: approvalResult.operationTitle,
              operationType: approvalResult.operationType,
              parameters: approvalResult.parameters,
            },
          };
        }

        const fileReferences =
          isRecord(result) && Array.isArray(result.fileReferences)
            ? result.fileReferences
            : undefined;

        return {
          success: true,
          integration: args.integrationName,
          operation: args.operation,
          data: result,
          ...(fileReferences ? { fileReferences } : {}),
        };
      } catch (error) {
        // Provide a helpful error message to the agent
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `Integration operation failed: ${args.integrationName}.${args.operation}\n` +
            `Error: ${errorMessage}\n\n` +
            `Troubleshooting tips:\n` +
            `• Verify the integration name is correct (use integration_introspect tool to list integrations)\n` +
            `• Check if the operation name exists for this integration\n` +
            `• Ensure required parameters are provided\n` +
            `• The integration might be inactive or credentials might be invalid`,
          { cause: error },
        );
      }
    },
  }),
} as const;
