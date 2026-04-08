import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import type { IntegrationOperationMetadata } from '../../approvals/types';
import type { IntegrationOperationMetadataLocal } from './types';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../../lib/shared/schemas/utils/json-value';
import { components } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';
import { toConvexJsonRecord } from '../../lib/type_cast_helpers';
import { triggerCompletionResponseHandler } from '../approval_shared';

export const updateApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    executionResult: jsonValueValidator,
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) return;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches IntegrationOperationMetadataLocal for integration_operation approvals
    const metadata = (approval.metadata ||
      {}) as IntegrationOperationMetadataLocal;
    const executedAt = Date.now();

    await ctx.db.patch(args.approvalId, {
      status: args.executionError ? 'rejected' : 'completed',
      executedAt,
      executionError: args.executionError || undefined,
      metadata: toConvexJsonRecord({
        ...metadata,
        executedAt,
        executionResult: args.executionResult,
        executionError: args.executionError || undefined,
      }),
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

export const saveSystemMessage = internalMutation({
  args: {
    threadId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'system', content: args.content },
    });
  },
});

export const triggerIntegrationCompletionResponse = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    agentSlug: v.string(),
    messageContent: v.string(),
    agentConfig: v.any(),
  },
  handler: async (ctx, args): Promise<void> => {
    await triggerCompletionResponseHandler(ctx, args, 'IntegrationComplete');
  },
});
