import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { handleStartWorkflow } from './helpers/engine/start_workflow_handler';
import { workflowManager } from './engine';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const startWorkflow = mutation({
	args: {
		organizationId: v.string(),
		wfDefinitionId: v.id('wfDefinitions'),
		input: v.optional(jsonValueValidator),
		triggeredBy: v.string(),
		triggerData: v.optional(jsonValueValidator),
	},
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
