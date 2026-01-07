/**
 * Convex Tool: Integration Batch
 *
 * Execute multiple integration operations in parallel.
 * Significantly reduces latency when querying multiple data sources.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';
import type { BatchOperationResult } from './types';

const batchOperationSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('Optional ID for tracking this operation in results'),
  operation: z
    .string()
    .describe('Operation name to execute'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Operation-specific parameters'),
});

const integrationBatchArgs = z.object({
  integrationName: z
    .string()
    .describe('Name of the configured integration'),
  operations: z
    .array(batchOperationSchema)
    .min(1)
    .max(10)
    .describe('List of operations to execute in parallel (1-10 operations)'),
});

export const integrationBatchTool: ToolDefinition = {
  name: 'integration_batch',
  tool: createTool({
    description: `Execute multiple integration operations in parallel.

Use this tool when you need to query multiple data sources from the same integration.
This significantly reduces latency compared to sequential single-operation calls.

WHEN TO USE:
• Need results from multiple read operations (e.g., list_reservations AND get_inhouse_guests)
• Want to reduce total query time by running operations in parallel
• Querying the same integration with different parameters

EXAMPLE:
{
  "integrationName": "protel",
  "operations": [
    { "id": "reservations", "operation": "list_reservations", "params": { "fromDate": "2026-01-01" } },
    { "id": "inhouse", "operation": "get_inhouse_guests" }
  ]
}

IMPORTANT NOTES:
• Maximum 10 operations per batch
• All operations must be on the same integration
• Results include success/failure status for each operation
• Write operations will return requiresApproval for each
• Operations are independent - one failure doesn't affect others
• Use 'id' field to easily identify results

WRITE OPERATIONS:
• Write operations in a batch will each create separate approval requests
• The batch result will include approvalId for each write operation
• User must approve each write operation separately`,

    args: integrationBatchArgs,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<BatchOperationResult> => {
      const { organizationId, threadId, messageId } = ctx;

      console.log('[integration_batch_tool] Starting batch execution:', {
        integrationName: args.integrationName,
        operationCount: args.operations.length,
        operations: args.operations.map(op => op.operation),
      });

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to execute integrations',
        );
      }

      try {
        const result = await ctx.runAction(
          internal.agent_tools.integrations.execute_batch_integration_internal
            .executeBatchIntegrationInternal,
          {
            organizationId,
            integrationName: args.integrationName,
            operations: args.operations.map(op => ({
              id: op.id,
              operation: op.operation,
              params: op.params || {},
            })),
            threadId,
            messageId,
          },
        );

        console.log('[integration_batch_tool] Batch execution complete:', {
          totalTime: result.stats.totalTime,
          successCount: result.stats.successCount,
          failureCount: result.stats.failureCount,
        });

        return result as BatchOperationResult;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `Batch integration operation failed: ${args.integrationName}\n` +
            `Error: ${errorMessage}\n\n` +
            `Troubleshooting tips:\n` +
            `• Verify the integration name is correct\n` +
            `• Check if all operation names exist for this integration\n` +
            `• Ensure required parameters are provided for each operation`,
        );
      }
    },
  }),
} as const;
