import type { WorkflowId } from '@convex-dev/workflow';

import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { SerializableAgentConfig } from '../../lib/agent_chat/types';

import { FEEDBACK_KEY } from '../../../lib/shared/schemas/approvals';
import { getString, isRecord } from '../../../lib/utils/type-guards';
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
  response: string | string[];
  respondedBy: string;
  approvedBy: string;
  agentConfig?: SerializableAgentConfig;
}

async function handleSubmission({
  ctx,
  approvalId,
  response,
  respondedBy,
  approvedBy,
  agentConfig: externalAgentConfig,
}: HandleArgs) {
  const approval = await ctx.db.get(approvalId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  if (approval.status !== 'pending') {
    throw new Error('Human input request has already been responded to');
  }

  if (approval.resourceType !== 'human_input_request') {
    throw new Error('Invalid approval type');
  }

  const threadId = approval.threadId;
  const organizationId = approval.organizationId;

  if (!threadId) {
    throw new Error('Human input request is not associated with a thread');
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is stored as v.any() but always matches HumanInputRequestMetadata for human_input_request approvals
  const existingMetadata = (approval.metadata ||
    {}) as HumanInputRequestMetadata;

  const updatedMetadata: HumanInputRequestMetadata = {
    ...existingMetadata,
    response: {
      value: response,
      respondedBy,
      timestamp: Date.now(),
    },
  };

  await ctx.db.patch(approvalId, {
    status: 'completed',
    approvedBy,
    reviewedAt: Date.now(),
    metadata: updatedMetadata,
  });

  const mapValueToLabel = (fieldLabel: string, value: string): string => {
    const field = existingMetadata.fields?.find((f) => f.label === fieldLabel);
    if (field && 'options' in field && field.options) {
      const option = field.options.find(
        (opt) => (opt.value ?? opt.label) === value,
      );
      if (option) return option.label;
    }
    return value;
  };

  let responseDisplay: string;
  if (typeof response === 'string') {
    try {
      const parsed: unknown = JSON.parse(response);
      if (isRecord(parsed)) {
        const feedbackVal = getString(parsed, FEEDBACK_KEY);
        if (feedbackVal !== undefined) {
          responseDisplay = `[Feedback] ${feedbackVal}`;
        } else {
          responseDisplay = Object.entries(parsed)
            .map(([key, val]) => {
              if (Array.isArray(val)) {
                return `${key}: ${val.map((item) => mapValueToLabel(key, String(item))).join(', ')}`;
              }
              return `${key}: ${mapValueToLabel(key, String(val))}`;
            })
            .join(', ');
        }
      } else {
        responseDisplay = response;
      }
    } catch (e) {
      console.error('Failed to parse human input response JSON:', e);
      responseDisplay = response;
    }
  } else {
    responseDisplay = response.join(', ');
  }
  const responseMessage = `[HUMAN_INPUT_RESPONSE] ${responseDisplay}`;

  // Workflow-context fork: resume the paused workflow via sendEvent instead of triggering chat agent
  if (approval.wfExecutionId) {
    const execution = await ctx.db.get(approval.wfExecutionId);
    if (!execution?.componentWorkflowId) {
      throw new Error(
        'Workflow execution not found or missing component workflow ID',
      );
    }

    const manager = workflowManagers[safeShardIndex(execution.shardIndex)];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- branded type cast from string stored in DB, same pattern as cancelExecution
    const workflowId = execution.componentWorkflowId as unknown as WorkflowId;

    await manager.sendEvent(ctx, {
      workflowId,
      name: `approval_response:${approval._id}`,
      value: {
        response,
        respondedBy,
        question: existingMetadata.question ?? '',
        timestamp: Date.now(),
        stepSlug: approval.stepSlug ?? '',
      },
    });

    // Post system message for AI context
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

  // Set generationStatus so the frontend shows loading indicator
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
      debugTag: '[ChatAgent:HumanInput]',
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
export const submitHumanInputResponseInternal = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
    respondedBy: v.string(),
    approvedBy: v.string(),
    agentConfig: v.optional(v.any()),
  },
  returns: approvalReturnValidator,
  handler: async (ctx, args) => {
    return handleSubmission({
      ctx,
      approvalId: args.approvalId,
      response: args.response,
      respondedBy: args.respondedBy,
      approvedBy: args.approvedBy,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() from Convex validator, shape guaranteed by the action caller
      agentConfig: args.agentConfig as SerializableAgentConfig | undefined,
    });
  },
});
