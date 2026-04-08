import { saveMessage } from '@convex-dev/agent';
import { v, type Infer } from 'convex/values';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../../lib/shared/schemas/utils/json-value';
import { components, internal } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';
import type { IntegrationOperationMetadata } from '../../approvals/types';
import { toConvexJsonRecord } from '../../lib/type_cast_helpers';
import { persistentStreaming } from '../../streaming/helpers';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;

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
    const { threadId, organizationId, agentSlug, messageContent, agentConfig } =
      args;

    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });

    const { messageId: promptMessageId } = await saveMessage(
      ctx,
      components.agent,
      {
        threadId,
        message: { role: 'system', content: messageContent },
      },
    );

    const streamId = await persistentStreaming.createStream(ctx);

    if (threadMeta) {
      await ctx.db.patch(threadMeta._id, {
        generationStatus: 'generating' as const,
        streamId,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.lib.agent_chat.internal_actions.runAgentGeneration,
      {
        agentType: 'custom',
        agentConfig,
        model: agentConfig.model ?? 'default',
        provider: agentConfig.provider,
        debugTag: `[${agentSlug}:IntegrationComplete]`,
        enableStreaming: true,
        threadId,
        organizationId,
        promptMessage: messageContent,
        streamId,
        promptMessageId,
        maxSteps: 20,
        userId: thread?.userId,
        deadlineMs: Date.now() + (agentConfig.timeoutMs ?? 420_000),
      },
    );
  },
});
