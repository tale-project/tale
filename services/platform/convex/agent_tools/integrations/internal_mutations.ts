import { v, type Infer } from 'convex/values';

import type { IntegrationOperationMetadata } from '../../approvals/types';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';

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

export const updateApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    executionResult: jsonValueValidator,
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) return;

    const metadata = (approval.metadata ||
      {}) as unknown as IntegrationOperationMetadataLocal;
    const executedAt = Date.now();

    await ctx.db.patch(args.approvalId, {
      executedAt,
      executionError: args.executionError || undefined,
      metadata: {
        ...metadata,
        executedAt,
        executionResult: args.executionResult as ConvexJsonValue,
        executionError: args.executionError || undefined,
      } as ConvexJsonRecord,
    });
  },
});

export const createIntegrationApproval = internalMutation({
  args: {
    organizationId: v.string(),
    integrationId: v.string(),
    integrationName: v.string(),
    integrationType: v.union(v.literal('sql'), v.literal('rest_api')),
    operationName: v.string(),
    operationTitle: v.string(),
    operationType: v.union(v.literal('read'), v.literal('write')),
    parameters: jsonRecordValidator,
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    estimatedImpact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const metadata: IntegrationOperationMetadata = {
      integrationId: args.integrationId,
      integrationName: args.integrationName,
      integrationType: args.integrationType,
      operationName: args.operationName,
      operationTitle: args.operationTitle,
      operationType: args.operationType,
      parameters: args.parameters,
      requestedAt: Date.now(),
      estimatedImpact: args.estimatedImpact,
    };

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'integration_operation',
      resourceId: `${args.integrationName}.${args.operationName}`,
      priority: 'high',
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });

    return approvalId;
  },
});
