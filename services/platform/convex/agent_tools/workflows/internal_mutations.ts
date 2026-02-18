import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { WorkflowCreationMetadata } from '../../approvals/types';

import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { components } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';
import { createApproval } from '../../approvals/helpers';

type ApprovalMetadata = Doc<'approvals'>['metadata'];

export const updateWorkflowApprovalWithResult = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    createdWorkflowId: v.union(v.id('wfDefinitions'), v.null()),
    executionError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) return;

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
        ),
        order: v.number(),
        config: jsonRecordValidator,
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
