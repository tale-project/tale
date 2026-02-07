import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { saveMessage } from '@convex-dev/agent';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { components } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { createApproval } from '../../approvals/helpers';
import type { WorkflowCreationMetadata } from '../../approvals/types';

type ApprovalMetadata = Doc<'approvals'>['metadata'];

export const updateWorkflowApprovalWithResult = internalMutation({
	args: {
		approvalId: v.id('approvals'),
		createdWorkflowId: v.union(v.id('wfDefinitions'), v.null()),
		executionError: v.union(v.string(), v.null()),
	},
	handler: async (ctx, args) => {
		const approval = await ctx.db.get(args.approvalId);
		if (!approval) return;

		const metadata = (approval.metadata || {}) as unknown as WorkflowCreationMetadata;

		const now = Date.now();
		await ctx.db.patch(args.approvalId, {
			executedAt: now,
			executionError: args.executionError ?? undefined,
			metadata: {
				...metadata,
				executedAt: now,
				...(args.createdWorkflowId ? { createdWorkflowId: args.createdWorkflowId } : {}),
				...(args.executionError ? { executionError: args.executionError } : {}),
			} as unknown as ApprovalMetadata,
		});
	},
});

export const saveSystemMessage = internalMutation({
	args: {
		threadId: v.string(),
		content: v.string(),
	},
	handler: async (ctx, args) => {
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
