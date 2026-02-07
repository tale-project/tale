import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { vWorkflowId } from '@convex-dev/workflow';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import * as EngineHelpers from './helpers/engine';
import { handleStartWorkflow } from './helpers/engine/start_workflow_handler';
import { workflowManager } from './engine';

export const onWorkflowComplete = internalMutation({
	args: {
		workflowId: vWorkflowId,
		context: jsonValueValidator,
		result: jsonValueValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await EngineHelpers.handleWorkflowComplete(ctx, args);
		return null;
	},
});

export const cleanupComponentWorkflow = internalMutation({
	args: {
		workflowId: vWorkflowId,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await EngineHelpers.cleanupComponentWorkflow(
			workflowManager,
			ctx,
			args.workflowId,
		);
		return null;
	},
});

export const startWorkflow = internalMutation({
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
