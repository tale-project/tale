/**
 * Factory for creating integration-bound tools.
 *
 * Creates a createTool() result scoped to a specific integration.
 * The integrationName is captured in a closure — the agent only needs
 * to specify operation + params.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { IntegrationExecutionResult } from './types';

import { getBoolean, isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

const boundIntegrationArgs = z.object({
  operation: z
    .string()
    .describe(
      'Operation name to execute (see available operations in description)',
    ),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Operation parameters as a JSON object. ' +
        'IMPORTANT: Include all required parameters for the operation.',
    ),
});

/**
 * Create a tool bound to a specific integration.
 *
 * @param integrationName - The integration name (baked into the tool)
 * @param operationsSummary - Concise operations list for the tool description
 * @returns A createTool() result ready to be added to extraTools
 */
export function createBoundIntegrationTool(
  integrationName: string,
  operationsSummary?: string,
) {
  const description = buildDescription(integrationName, operationsSummary);

  return createTool({
    description,
    args: boundIntegrationArgs,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<IntegrationExecutionResult> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to execute integrations',
        );
      }

      try {
        const result = await ctx.runAction(
          internal.agent_tools.integrations.internal_actions.executeIntegration,
          {
            organizationId,
            integrationName,
            operation: args.operation,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
            params: (args.params || {}) as Record<
              string,
              string | number | boolean | null
            >,
            threadId,
            messageId,
          },
        );

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
          return {
            success: true,
            integration: integrationName,
            operation: args.operation,
            requiresApproval: true,
            approvalId: result.approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${result.approvalId}) has been created for "${result.operationTitle || args.operation}" on ${integrationName}. The user must approve or reject this operation in the chat UI before it will be executed.`,
            data: {
              approvalId: result.approvalId,
              operationName: result.operationName,
              operationTitle: result.operationTitle,
              operationType: result.operationType,
              parameters: result.parameters,
            },
          };
        }

        return {
          success: true,
          integration: integrationName,
          operation: args.operation,
          data: result,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `Integration operation failed: ${integrationName}.${args.operation}\n` +
            `Error: ${errorMessage}\n\n` +
            `Troubleshooting:\n` +
            `• Check if the operation name exists for this integration\n` +
            `• Ensure required parameters are provided`,
          { cause: error },
        );
      }
    },
  });
}

function buildDescription(
  integrationName: string,
  operationsSummary?: string,
): string {
  const lines = [`Execute operations on the "${integrationName}" integration.`];

  if (operationsSummary) {
    lines.push('', operationsSummary);
  }

  lines.push(
    '',
    `Usage: { operation: "<operation_name>", params: { ... } }`,
    'Write operations create approval cards for user review.',
  );

  return lines.join('\n');
}
