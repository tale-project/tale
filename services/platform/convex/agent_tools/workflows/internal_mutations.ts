import { saveMessage } from '@convex-dev/agent';
import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type {
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
} from '../../approvals/types';

import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { components, internal } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';
import { toSerializableConfig } from '../../custom_agents/config';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { checkOrganizationRateLimit } from '../../lib/rate_limiter/helpers';
import { persistentStreaming } from '../../streaming/helpers';
import { stepConfigValidator } from '../../workflow_engine/types/nodes';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

type ApprovalMetadata = Doc<'approvals'>['metadata'];

export const updateWorkflowApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    createdWorkflowId: v.union(v.id('wfDefinitions'), v.null()),
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.executedAt) return;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowCreationMetadata for workflow_creation approvals
    const metadata = (approval.metadata || {}) as WorkflowCreationMetadata;

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      executedAt: now,
      executionError: args.executionError ?? undefined,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- constructing approval metadata from known WorkflowCreationMetadata fields
      metadata: {
        ...metadata,
        executedAt: now,
        ...(args.createdWorkflowId
          ? { createdWorkflowId: args.createdWorkflowId }
          : {}),
        ...(args.executionError ? { executionError: args.executionError } : {}),
      } as ApprovalMetadata,
    });
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

export const triggerWorkflowCompletionResponse = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    messageContent: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const { threadId, organizationId, messageContent } = args;

    const systemChatQuery = ctx.db
      .query('customAgents')
      .withIndex('by_org_system_slug', (q) =>
        q.eq('organizationId', organizationId).eq('systemAgentSlug', 'chat'),
      );

    let chatAgent = null;
    for await (const agent of systemChatQuery) {
      if (agent.status === 'active') {
        chatAgent = agent;
        break;
      }
    }

    if (!chatAgent) {
      console.warn(
        '[triggerWorkflowCompletionResponse] System default chat agent not found for org:',
        organizationId,
      );
      return;
    }

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });

    const { messageId: promptMessageId } = await saveMessage(
      ctx,
      components.agent,
      {
        threadId,
        message: { role: 'user', content: messageContent },
      },
    );

    const agentConfig = toSerializableConfig(chatAgent);
    const { model, provider } = getDefaultAgentRuntimeConfig();
    const streamId = await persistentStreaming.createStream(ctx);
    const beforeGenerate = await createFunctionHandle(beforeGenerateHookRef);

    await ctx.scheduler.runAfter(
      0,
      internal.lib.agent_chat.internal_actions.runAgentGeneration,
      {
        agentType: 'custom',
        agentConfig,
        model: agentConfig.model ?? model,
        provider,
        debugTag: '[ChatAgent:WorkflowComplete]',
        enableStreaming: true,
        hooks: { beforeGenerate },
        threadId,
        organizationId,
        promptMessage: messageContent,
        streamId,
        promptMessageId,
        maxSteps: 20,
        userId: thread?.userId,
        deadlineMs: Date.now() + 60_000,
      },
    );
  },
});

export const createWorkflowCreationApproval = internalMutation({
  args: {
    organizationId: v.string(),
    workflowName: v.string(),
    workflowDescription: v.optional(v.string()),
    workflowConfig: v.object({
      name: v.string(),
      description: v.optional(v.string()),
      version: v.optional(v.string()),
      workflowType: v.optional(v.literal('predefined')),
      config: v.optional(jsonRecordValidator),
    }),
    stepsConfig: v.array(
      v.object({
        stepSlug: v.string(),
        name: v.string(),
        stepType: v.union(
          v.literal('start'),
          v.literal('trigger'),
          v.literal('llm'),
          v.literal('action'),
          v.literal('condition'),
          v.literal('loop'),
          v.literal('output'),
        ),
        order: v.number(),
        config: stepConfigValidator,
        nextSteps: v.record(v.string(), v.string()),
      }),
    ),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    const metadata: WorkflowCreationMetadata = {
      workflowName: args.workflowName,
      workflowDescription: args.workflowDescription,
      workflowConfig: {
        name: args.workflowConfig.name,
        description: args.workflowConfig.description,
        version: args.workflowConfig.version,
        workflowType: args.workflowConfig.workflowType,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns broader type; config is always Record<string, unknown>
        config: args.workflowConfig.config as
          | Record<string, unknown>
          | undefined,
      },
      stepsConfig: args.stepsConfig.map((step) => ({
        stepSlug: step.stepSlug,
        name: step.name,
        stepType: step.stepType,
        order: step.order,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns broader type; config is always Record<string, unknown>
        config: step.config as Record<string, unknown>,
        nextSteps: step.nextSteps,
      })),
      requestedAt: Date.now(),
    };

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'workflow_creation',
      resourceId: `workflow:${args.workflowName}`,
      priority: 'high',
      description: `Create workflow: ${args.workflowName}${args.workflowDescription ? ` - ${args.workflowDescription}` : ''}`,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });

    return approvalId;
  },
});

export const createWorkflowRunApproval = internalMutation({
  args: {
    organizationId: v.string(),
    workflowId: v.id('wfDefinitions'),
    workflowName: v.string(),
    workflowDescription: v.optional(v.string()),
    parameters: v.optional(jsonRecordValidator),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    await checkOrganizationRateLimit(ctx, 'workflow:run', args.organizationId);

    const metadata: WorkflowRunMetadata = {
      workflowId: args.workflowId,
      workflowName: args.workflowName,
      workflowDescription: args.workflowDescription,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns broader type; parameters is always Record<string, unknown>
      parameters: args.parameters as Record<string, unknown> | undefined,
      requestedAt: Date.now(),
    };

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'workflow_run',
      resourceId: `workflow_run:${args.workflowId}`,
      priority: 'high',
      description: `Run workflow: ${args.workflowName}${args.workflowDescription ? ` - ${args.workflowDescription}` : ''}`,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });

    return approvalId;
  },
});

export const updateWorkflowRunApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    executionId: v.union(v.id('wfExecutions'), v.null()),
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.executedAt) return;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowRunMetadata for workflow_run approvals
    const metadata = (approval.metadata || {}) as WorkflowRunMetadata;

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      executedAt: now,
      executionError: args.executionError ?? undefined,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- constructing approval metadata from known WorkflowRunMetadata fields
      metadata: {
        ...metadata,
        executedAt: now,
        ...(args.executionId ? { executionId: args.executionId } : {}),
        ...(args.executionError ? { executionError: args.executionError } : {}),
      } as ApprovalMetadata,
    });
  },
});
