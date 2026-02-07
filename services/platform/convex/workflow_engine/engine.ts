/**
 * Workflow Engine - Convex Function Definitions
 *
 * This file contains the workflow manager and dynamic workflow definition.
 * Internal mutations are in internal_mutations.ts.
 * Internal actions are in internal_actions.ts.
 */

import { v } from 'convex/values';
import { WorkflowManager } from '@convex-dev/workflow';
import { components } from '../_generated/api';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

import * as EngineHelpers from './helpers/engine';

export const workflowManager = new WorkflowManager(components.workflow);

export const dynamicWorkflow = workflowManager.define({
	args: {
		organizationId: v.string(),
		executionId: v.id('wfExecutions'),
		workflowDefinition: jsonValueValidator,
		steps: v.array(jsonValueValidator),
		input: v.optional(jsonValueValidator),
		triggeredBy: v.string(),
		triggerData: v.optional(jsonValueValidator),
		resumeFromStepSlug: v.optional(v.string()),
		resumeVariables: v.optional(jsonValueValidator),
		threadId: v.optional(v.string()),
	},
	handler: async (step, args): Promise<void> => {
		await EngineHelpers.handleDynamicWorkflow(step, args);
	},
});
