import type { WorkflowId } from '@convex-dev/workflow';

import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';

import { FEEDBACK_KEY } from '../../../lib/shared/schemas/approvals';
import { getString, isRecord } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { mutation } from '../../_generated/server';
import {
  getDefaultAgentRuntimeConfig,
  getDefaultModel,
} from '../../lib/agent_runtime_config';
import { getOrganizationMember } from '../../lib/rls';
import { persistentStreaming } from '../../streaming/helpers';
import { workflowManagers } from '../../workflow_engine/engine';
import { safeShardIndex } from '../../workflow_engine/helpers/engine/shard';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

export const submitHumanInputResponse = mutation({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
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

    await getOrganizationMember(ctx, organizationId);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is stored as v.any() but always matches HumanInputRequestMetadata for human_input_request approvals
    const existingMetadata = (approval.metadata ||
      {}) as HumanInputRequestMetadata;
    const respondedBy = identity.email ?? identity.subject;

    const updatedMetadata: HumanInputRequestMetadata = {
      ...existingMetadata,
      response: {
        value: args.response,
        respondedBy,
        timestamp: Date.now(),
      },
    };

    await ctx.db.patch(args.approvalId, {
      status: 'completed',
      approvedBy: identity.subject,
      reviewedAt: Date.now(),
      metadata: updatedMetadata,
    });

    const mapValueToLabel = (fieldLabel: string, value: string): string => {
      const field = existingMetadata.fields?.find(
        (f) => f.label === fieldLabel,
      );
      if (field && 'options' in field && field.options) {
        const option = field.options.find(
          (opt) => (opt.value ?? opt.label) === value,
        );
        if (option) return option.label;
      }
      return value;
    };

    let responseDisplay: string;
    if (typeof args.response === 'string') {
      try {
        const parsed: unknown = JSON.parse(args.response);
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
          responseDisplay = args.response;
        }
      } catch (e) {
        console.error('Failed to parse human input response JSON:', e);
        responseDisplay = args.response;
      }
    } else {
      responseDisplay = args.response.join(', ');
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
          response: args.response,
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
    // Use default model config for re-triggering after human input.
    // The agent config was already established when the thread was created;
    // the generation action will use the thread's existing context.
    const { model, provider } = getDefaultAgentRuntimeConfig();
    const agentConfig = {
      name: 'chat-agent',
      instructions: '',
      convexToolNames: [],
      model: getDefaultModel(),
      enableVectorSearch: false,
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
        model: agentConfig.model ?? model,
        provider,
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
