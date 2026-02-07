import { mutation, internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { handleStartWorkflow } from './helpers/engine/start_workflow_handler';
import { workflowManager } from './engine';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

const startWorkflowArgs = {
	organizationId: v.string(),
	wfDefinitionId: v.id('wfDefinitions'),
	input: v.optional(jsonValueValidator),
	triggeredBy: v.string(),
	triggerData: v.optional(jsonValueValidator),
};

export const startWorkflow = mutation({
	args: startWorkflowArgs,
	returns: v.id('wfExecutions'),
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new Error('Unauthenticated');
		}

		await getOrganizationMember(ctx, args.organizationId, {
			userId: String(authUser._id),
			email: authUser.email,
			name: authUser.name,
		});

		return await handleStartWorkflow(ctx, args, workflowManager);
	},
});

export const internalStartWorkflow = internalMutation({
	args: startWorkflowArgs,
	returns: v.id('wfExecutions'),
	handler: async (ctx, args) => {
		return await handleStartWorkflow(ctx, args, workflowManager);
	},
});
