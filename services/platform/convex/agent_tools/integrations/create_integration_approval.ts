/**
 * Internal Mutation: Create Integration Operation Approval
 *
 * Creates an approval record for an integration operation that requires user confirmation.
 */

import { internalMutation } from '../../_generated/server';
import { v } from 'convex/values';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { createApproval } from '../../approvals/helpers';
import type { IntegrationOperationMetadata } from '../../approvals/types';

/**
 * Create an approval for an integration operation
 */
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
