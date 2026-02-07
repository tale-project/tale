import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import * as EngineHelpers from './helpers/engine';
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
	handler: async (ctx, args): Promise<Id<'wfExecutions'>> => {
		return await EngineHelpers.handleStartWorkflow(ctx, args, workflowManager);
	},
});
