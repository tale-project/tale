/**
 * Internal Action: Execute Approved Integration Operation
 *
 * Executes an integration operation that has been approved by a user.
 */

import { internalAction, internalMutation } from '../../_generated/server';
import { v, Infer } from 'convex/values';
import { internal } from '../../_generated/api';
import { jsonValueValidator, jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;
type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;

interface IntegrationOperationMetadataLocal {
  integrationId: string;
  integrationName: string;
  integrationType: string;
  operationName: string;
  operationDescription?: string;
  operationCategory?: string;
  parameters?: Record<string, ConvexJsonValue>;
  requiresApproval: boolean;
  requestedAt?: number;
  executedAt?: number;
  executionResult?: ConvexJsonValue;
  executionError?: string | null;
}

/**
 * Execute an approved integration operation
 */
export const executeApprovedOperation = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<ConvexJsonValue> => {
    // Get the approval record
    const approval: {
      _id: unknown;
      status: string;
      resourceType: string;
      organizationId: string;
      metadata?: Record<string, ConvexJsonValue>;
    } | null = await ctx.runQuery(internal.approvals.queries.getApprovalById, {
      approvalId: args.approvalId,
    });

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'approved') {
      throw new Error(
        `Cannot execute operation: approval status is "${approval.status}", expected "approved"`,
      );
    }

    if (approval.resourceType !== 'integration_operation') {
      throw new Error(
        `Invalid approval type: expected "integration_operation", got "${approval.resourceType}"`,
      );
    }

    const metadata = approval.metadata as unknown as IntegrationOperationMetadataLocal | undefined;

    if (!metadata?.integrationName || !metadata?.operationName) {
      throw new Error(
        'Invalid approval metadata: missing integration or operation name',
      );
    }

    // Execute the integration operation with error handling
    try {
      const result = await ctx.runAction(
        internal.agent_tools.integrations.execute_integration_internal
          .executeIntegrationInternal,
        {
          organizationId: approval.organizationId,
          integrationName: metadata.integrationName,
          operation: metadata.operationName,
          params: metadata.parameters as ConvexJsonRecord | undefined,
          skipApprovalCheck: true, // Skip approval check since we're executing an approved operation
        },
      );

      // Update approval with execution result
      await ctx.runMutation(
        internal.agent_tools.integrations.execute_approved_operation
          .updateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionResult: result as ConvexJsonValue,
          executionError: null,
        },
      );

      return result as ConvexJsonValue;
    } catch (error) {
      // Store the error in the approval record
      const errorMessage = error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.integrations.execute_approved_operation
          .updateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionResult: null,
          executionError: errorMessage,
        },
      );

      // Re-throw the error so the caller knows execution failed
      throw error;
    }
  },
});

/**
 * Update approval with execution result (internal mutation)
 */
export const updateApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    executionResult: jsonValueValidator,
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) return;

    // Cast metadata - this mutation is only called for integration_operation approvals
    const metadata = (approval.metadata || {}) as unknown as IntegrationOperationMetadataLocal;

    await ctx.db.patch(args.approvalId, {
      executedAt: Date.now(),
      executionError: args.executionError || undefined,
      metadata: {
        ...metadata,
        executedAt: Date.now(),
        executionResult: args.executionResult as ConvexJsonValue,
        executionError: args.executionError || undefined,
      } as ConvexJsonRecord,
    });
  },
});
