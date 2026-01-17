/**
 * Internal Mutation: Create Workflow Creation Approval
 *
 * Creates an approval record for a workflow creation that requires user confirmation.
 */

import { internalMutation } from '../../_generated/server';
import { v } from 'convex/values';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { createApproval } from '../../approvals/helpers';
import type { WorkflowCreationMetadata } from '../../approvals/types';

/**
 * Create an approval for a workflow creation
 */
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
  handler: async (ctx, args) => {
    const metadata: WorkflowCreationMetadata = {
      workflowName: args.workflowName,
      workflowDescription: args.workflowDescription,
      workflowConfig: {
        name: args.workflowConfig.name,
        description: args.workflowConfig.description,
        version: args.workflowConfig.version,
        workflowType: args.workflowConfig.workflowType,
        config: args.workflowConfig.config as Record<string, unknown> | undefined,
      },
      stepsConfig: args.stepsConfig.map((step) => ({
        stepSlug: step.stepSlug,
        name: step.name,
        stepType: step.stepType,
        order: step.order,
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
