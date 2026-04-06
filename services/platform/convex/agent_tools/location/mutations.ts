import type { WorkflowId } from '@convex-dev/workflow';

import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { LocationRequestMetadata } from '../../../lib/shared/schemas/approvals';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';

import { components, internal } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';
import { persistentStreaming } from '../../streaming/helpers';
import { workflowManagers } from '../../workflow_engine/engine';
import { safeShardIndex } from '../../workflow_engine/helpers/engine/shard';
import {
  approvalReturnValidator,
  DEFAULT_AGENT_CONFIG,
} from '../approval_shared';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

interface HandleArgs {
  ctx: MutationCtx;
  approvalId: Id<'approvals'>;
  location?: string;
  denied?: boolean;
  respondedBy: string;
  approvedBy: string;
  agentConfig?: SerializableAgentConfig;
}

async function handleSubmission({
  ctx,
  approvalId,
  location,
  denied,
  respondedBy,
  approvedBy,
  agentConfig: externalAgentConfig,
}: HandleArgs) {
  const approval = await ctx.db.get(approvalId);
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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is stored as v.any() but always matches LocationRequestMetadata for location_request approvals
  const existingMetadata = (approval.metadata || {}) as LocationRequestMetadata;

  const isDenied = denied === true || !location;

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

  await ctx.db.patch(approvalId, {
    status: isDenied ? 'rejected' : 'completed',
    approvedBy,
    reviewedAt: Date.now(),
    metadata: updatedMetadata,
  });

  const responseMessage = isDenied
    ? '[LOCATION_RESPONSE] User denied location access. Proceed without location data.'
    : `[LOCATION_RESPONSE] User location: ${location}`;

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
        response: isDenied ? '__denied__' : location,
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

  // Use resolved agent config if provided (from action), otherwise fall back to default
  const agentConfig = externalAgentConfig ?? DEFAULT_AGENT_CONFIG;
  const model = agentConfig.model ?? 'default';
  const timeoutMs = agentConfig.timeoutMs ?? 1_200_000;

  const beforeGenerate = await createFunctionHandle(beforeGenerateHookRef);

  await ctx.scheduler.runAfter(
    0,
    internal.lib.agent_chat.internal_actions.runAgentGeneration,
    {
      agentType: 'custom',
      agentConfig,
      model,
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
      deadlineMs: Date.now() + timeoutMs,
    },
  );

  return {
    success: true,
    threadId,
    streamId,
  };
}

/**
 * Internal mutation — called from the action wrapper which resolves agent config first.
 * Auth and org membership are verified in the action layer before calling this.
 */
export const submitLocationResponseInternal = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    location: v.optional(v.string()),
    denied: v.optional(v.boolean()),
    respondedBy: v.string(),
    approvedBy: v.string(),
    agentConfig: v.optional(v.any()),
  },
  returns: approvalReturnValidator,
  handler: async (ctx, args) => {
    return handleSubmission({
      ctx,
      approvalId: args.approvalId,
      location: args.location,
      denied: args.denied,
      respondedBy: args.respondedBy,
      approvedBy: args.approvedBy,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() from Convex validator, shape guaranteed by the action caller
      agentConfig: args.agentConfig as SerializableAgentConfig | undefined,
    });
  },
});
