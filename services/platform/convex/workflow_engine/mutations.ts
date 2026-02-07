import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { handleStartWorkflow } from './helpers/engine/start_workflow_handler';
import { workflowManager } from './engine';

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
		return await handleStartWorkflow(ctx, args, workflowManager);
	},
});
