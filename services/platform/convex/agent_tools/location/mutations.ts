import type { WorkflowId } from '@convex-dev/workflow';

import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { LocationRequestMetadata } from '../../../lib/shared/schemas/approvals';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

import { components, internal } from '../../_generated/api';
import { internalMutation, mutation } from '../../_generated/server';
import { getOrganizationMember } from '../../lib/rls';
import { persistentStreaming } from '../../streaming/helpers';
import { workflowManagers } from '../../workflow_engine/engine';
import { safeShardIndex } from '../../workflow_engine/helpers/engine/shard';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

const DEFAULT_AGENT_CONFIG = {
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

const returnValidator = v.object({
  success: v.boolean(),
  threadId: v.optional(v.string()),
  streamId: v.optional(v.string()),
});

interface HandleArgs {
  ctx: MutationCtx;
  approvalId: Id<'approvals'>;
  location?: string;
  denied?: boolean;
  respondedBy: string;
  approvedBy: string;
  agentConfig?: Record<string, unknown>;
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
  const model = (agentConfig.model as string) ?? 'default';
  const timeoutMs = (agentConfig.timeoutMs as number) ?? 1_200_000;

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
 * Public mutation — called directly from the frontend when the action wrapper is not used.
 * @deprecated Prefer the action in actions.ts which resolves the agent config.
 */
export const submitLocationResponse = mutation({
  args: {
    approvalId: v.id('approvals'),
    location: v.optional(v.string()),
    denied: v.optional(v.boolean()),
  },
  returns: returnValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(
      ctx,
      (await ctx.db.get(args.approvalId))?.organizationId ?? '',
    );

    return handleSubmission({
      ctx,
      approvalId: args.approvalId,
      location: args.location,
      denied: args.denied,
      respondedBy: identity.email ?? identity.subject,
      approvedBy: identity.subject,
    });
  },
});

/**
 * Internal mutation — called from the action wrapper which resolves agent config first.
 */
export const submitLocationResponseInternal = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    location: v.optional(v.string()),
    denied: v.optional(v.boolean()),
    userId: v.string(),
    agentConfig: v.optional(v.any()),
  },
  returns: returnValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    return handleSubmission({
      ctx,
      approvalId: args.approvalId,
      location: args.location,
      denied: args.denied,
      respondedBy: identity.email ?? identity.subject,
      approvedBy: identity.subject,
      agentConfig: args.agentConfig,
    });
  },
});
