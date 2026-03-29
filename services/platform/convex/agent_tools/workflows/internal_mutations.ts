import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type {
  WorkflowCreationMetadata,
  WorkflowRunMetadata,
  WorkflowUpdateMetadata,
} from '../../approvals/types';

import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { components, internal } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';
import {
  getDefaultAgentRuntimeConfig,
  getDefaultModel,
} from '../../lib/agent_runtime_config';
import { checkOrganizationRateLimit } from '../../lib/rate_limiter/helpers';
import { persistentStreaming } from '../../streaming/helpers';
import { stepConfigValidator } from '../../workflow_engine/types/nodes';

type ApprovalMetadata = Doc<'approvals'>['metadata'];

export const claimWorkflowApprovalForExecution = internalMutation({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');
    if (approval.executedAt) return false;
    await ctx.db.patch(args.approvalId, { executedAt: Date.now() });
    return true;
  },
});

export const updateWorkflowApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    createdWorkflowSlug: v.union(v.string(), v.null()),
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowCreationMetadata for workflow_creation approvals
    const metadata = (approval.metadata || {}) as WorkflowCreationMetadata;

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: args.executionError ? 'rejected' : 'completed',
      executedAt: now,
      executionError: args.executionError ?? undefined,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- constructing approval metadata from known WorkflowCreationMetadata fields
      metadata: {
        ...metadata,
        executedAt: now,
        ...(args.createdWorkflowSlug
          ? { createdWorkflowSlug: args.createdWorkflowSlug }
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

    // Resolve the agent from thread metadata
    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();

    const agentId = threadMeta?.agentId;
    if (!agentId) {
      throw new Error(
        `[triggerWorkflowCompletionResponse] Thread ${threadId} has no agentId`,
      );
    }

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

    const { model, provider } = getDefaultAgentRuntimeConfig();
    const agentConfig = {
      name: String(agentId),
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
        model: agentConfig.model ?? model,
        provider,
        debugTag: `[Agent:${agentId}:WorkflowComplete]`,
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
    workflowSlug: v.string(),
    workflowName: v.string(),
    workflowDescription: v.optional(v.string()),
    parameters: v.optional(jsonRecordValidator),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    await checkOrganizationRateLimit(ctx, 'workflow:run', args.organizationId);

    const metadata: WorkflowRunMetadata = {
      workflowSlug: args.workflowSlug,
      workflowName: args.workflowName,
      workflowDescription: args.workflowDescription,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns broader type; parameters is always Record<string, unknown>
      parameters: args.parameters as Record<string, unknown> | undefined,
      requestedAt: Date.now(),
    };

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'workflow_run',
      resourceId: `workflow_run:${args.workflowSlug}`,
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

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowRunMetadata for workflow_run approvals
    const metadata = (approval.metadata || {}) as WorkflowRunMetadata;

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      // On error: reject immediately. On success: keep 'executing' — the workflow
      // runs asynchronously and onWorkflowComplete will set 'completed' when done.
      ...(args.executionError ? { status: 'rejected' as const } : {}),
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

export const createWorkflowUpdateApproval = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    workflowName: v.string(),
    workflowVersion: v.string(),
    updateSummary: v.string(),
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
        config: stepConfigValidator,
        nextSteps: v.record(v.string(), v.string()),
      }),
    ),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    const metadata: WorkflowUpdateMetadata = {
      updateType: 'full_save',
      updateSummary: args.updateSummary,
      workflowSlug: args.workflowSlug,
      workflowName: args.workflowName,
      workflowVersion: args.workflowVersion,
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
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns broader type; config is always Record<string, unknown>
        config: step.config as Record<string, unknown>,
        nextSteps: step.nextSteps,
      })),
      requestedAt: Date.now(),
    };

    return await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'workflow_update',
      resourceId: `workflow_update:${args.workflowSlug}`,
      priority: 'high',
      description: `Update workflow: ${args.workflowName} — ${args.updateSummary}`,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });
  },
});

export const createWorkflowStepUpdateApproval = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    workflowName: v.string(),
    workflowVersion: v.string(),
    updateSummary: v.string(),
    stepSlug: v.string(),
    stepName: v.string(),
    stepUpdates: jsonRecordValidator,
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    const metadata: WorkflowUpdateMetadata = {
      updateType: 'step_patch',
      updateSummary: args.updateSummary,
      workflowSlug: args.workflowSlug,
      workflowName: args.workflowName,
      workflowVersion: args.workflowVersion,
      stepSlug: args.stepSlug,
      stepName: args.stepName,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns broader type; stepUpdates is always Record<string, unknown>
      stepUpdates: args.stepUpdates as Record<string, unknown>,
      requestedAt: Date.now(),
    };

    return await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'workflow_update',
      resourceId: `workflow_update:${args.workflowSlug}:${args.stepSlug}`,
      priority: 'high',
      description: `Update step "${args.stepName}" in workflow "${args.workflowName}" — ${args.updateSummary}`,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });
  },
});

export const createBatchWorkflowStepUpdateApproval = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    workflowName: v.string(),
    workflowVersion: v.string(),
    updateSummary: v.string(),
    steps: v.array(
      v.object({
        stepSlug: v.string(),
        stepName: v.string(),
        stepUpdates: jsonRecordValidator,
      }),
    ),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    const metadata: WorkflowUpdateMetadata = {
      updateType: 'multi_step_patch',
      updateSummary: args.updateSummary,
      workflowSlug: args.workflowSlug,
      workflowName: args.workflowName,
      workflowVersion: args.workflowVersion,
      steps: args.steps.map((s) => ({
        stepSlug: s.stepSlug,
        stepName: s.stepName,
        stepUpdates: Object.fromEntries(Object.entries(s.stepUpdates)),
      })),
      requestedAt: Date.now(),
    };

    const stepNames = args.steps.map((s) => `"${s.stepName}"`).join(', ');
    return await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'workflow_update',
      resourceId: `workflow_update:${args.workflowSlug}:batch:${Date.now()}`,
      priority: 'high',
      description: `Update ${args.steps.length} steps (${stepNames}) in workflow "${args.workflowName}" — ${args.updateSummary}`,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });
  },
});

export const updateWorkflowUpdateApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new Error('Approval not found');

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval.metadata is v.any() but always matches WorkflowUpdateMetadata for workflow_update approvals
    const metadata = (approval.metadata || {}) as WorkflowUpdateMetadata;

    const now = Date.now();
    await ctx.db.patch(args.approvalId, {
      status: args.executionError ? 'rejected' : 'completed',
      executedAt: now,
      executionError: args.executionError ?? undefined,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- constructing approval metadata from known WorkflowUpdateMetadata fields
      metadata: {
        ...metadata,
        executedAt: now,
        ...(args.executionError ? { executionError: args.executionError } : {}),
      } as ApprovalMetadata,
    });
  },
});
