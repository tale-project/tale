import type { WorkflowId } from '@convex-dev/workflow';

import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { LocationRequestMetadata } from '../../../lib/shared/schemas/approvals';

import { components, internal } from '../../_generated/api';
import { mutation } from '../../_generated/server';
import { getOrganizationMember } from '../../lib/rls';
import { persistentStreaming } from '../../streaming/helpers';
import { workflowManagers } from '../../workflow_engine/engine';
import { safeShardIndex } from '../../workflow_engine/helpers/engine/shard';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

export const submitLocationResponse = mutation({
  args: {
    approvalId: v.id('approvals'),
    location: v.optional(v.string()),
    denied: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error('Location request has already been responded to');
    }

    if (approval.resourceType !== 'location_request') {
      throw new Error('Invalid approval type');
    }

    const threadId = approval.threadId;
    const organizationId = approval.organizationId;

    if (!threadId) {
      throw new Error('Location request is not associated with a thread');
    }

    await getOrganizationMember(ctx, organizationId);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is stored as v.any() but always matches LocationRequestMetadata for location_request approvals
    const existingMetadata = (approval.metadata ||
      {}) as LocationRequestMetadata;
    const respondedBy = identity.email ?? identity.subject;

    const location = args.location;
    const isDenied = args.denied === true || !location;

    const updatedMetadata: LocationRequestMetadata = {
      ...existingMetadata,
      ...(isDenied
        ? { denied: true }
        : {
            response: {
              location,
              respondedBy,
              timestamp: Date.now(),
            },
          }),
    };

    await ctx.db.patch(args.approvalId, {
      status: isDenied ? 'rejected' : 'completed',
      approvedBy: identity.subject,
      reviewedAt: Date.now(),
      metadata: updatedMetadata,
    });

    const responseMessage = isDenied
      ? '[LOCATION_RESPONSE] User denied location access. Proceed without location data.'
      : `[LOCATION_RESPONSE] User location: ${args.location}`;

    // Workflow-context fork
    if (approval.wfExecutionId) {
      const execution = await ctx.db.get(approval.wfExecutionId);
      if (!execution?.componentWorkflowId) {
        throw new Error(
          'Workflow execution not found or missing component workflow ID',
        );
      }

      const manager = workflowManagers[safeShardIndex(execution.shardIndex)];
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- branded type cast from string stored in DB
      const workflowId = execution.componentWorkflowId as unknown as WorkflowId;

      await manager.sendEvent(ctx, {
        workflowId,
        name: `approval_response:${approval._id}`,
        value: {
          response: isDenied ? '__denied__' : args.location,
          respondedBy,
          question: existingMetadata.reason ?? '',
          timestamp: Date.now(),
          stepSlug: approval.stepSlug ?? '',
        },
      });

      await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: 'system', content: responseMessage },
      });

      return { success: true, threadId };
    }

    // Chat-context flow: trigger agent generation
    const { messageId: promptMessageId } = await saveMessage(
      ctx,
      components.agent,
      {
        threadId,
        message: { role: 'system', content: responseMessage },
      },
    );

    const streamId = await persistentStreaming.createStream(ctx);

    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();
    if (threadMeta) {
      await ctx.db.patch(threadMeta._id, {
        generationStatus: 'generating' as const,
        streamId,
      });
    }

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });

    const agentConfig = {
      name: 'chat-agent',
      instructions: '',
      convexToolNames: [],
      model: 'default',
      knowledgeMode: 'off' as const,
      webSearchMode: 'off' as const,
      includeTeamKnowledge: false,
      includeOrgKnowledge: false,
      knowledgeFileIds: [],
      structuredResponsesEnabled: true,
      timeoutMs: 1_200_000,
    };

    const beforeGenerate = await createFunctionHandle(beforeGenerateHookRef);

    await ctx.scheduler.runAfter(
      0,
      internal.lib.agent_chat.internal_actions.runAgentGeneration,
      {
        agentType: 'custom',
        agentConfig,
        model: agentConfig.model,
        debugTag: '[ChatAgent:Location]',
        enableStreaming: true,
        hooks: { beforeGenerate },
        threadId,
        organizationId,
        promptMessage: responseMessage,
        streamId,
        promptMessageId,
        maxSteps: 500,
        userId: thread?.userId,
        deadlineMs: Date.now() + (agentConfig.timeoutMs ?? 420_000),
      },
    );

    return {
      success: true,
      threadId,
      streamId,
    };
  },
});
