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
  id: z.string().optional().describe('Optional ID for tracking in results (e.g., "query1", "query2")'),
  operation: z.string().describe('Operation name (e.g., "get_guest", "get_reservations")'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Parameters as JSON object. Example: { "guestId": 123 }. ' +
        'Include all required params from integration_introspect.',
    ),
});

const integrationBatchArgs = z.object({
  integrationName: z.string().describe('Integration name (e.g., "protel")'),
  operations: z
    .array(batchOperationSchema)
    .min(1)
    .max(10)
    .describe(
      'Array of operations (1-10). Example: [{ "operation": "get_guest", "params": { "guestId": 123 } }]',
    ),
});

export const integrationBatchTool: ToolDefinition = {
  name: 'integration_batch',
  tool: createTool({
    description: `Execute multiple read operations in parallel on the same integration.

Example call:
{
  integrationName: "protel",
  operations: [
    { id: "q1", operation: "get_guest", params: { "guestId": 123 } },
    { id: "q2", operation: "get_reservations", params: { "roomNumber": "101" } }
  ]
}

Max 10 operations. Use 'id' field to identify results.`,

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
