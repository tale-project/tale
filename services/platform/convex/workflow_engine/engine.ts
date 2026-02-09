/**
 * Workflow Engine - Convex Function Definitions
 *
 * This file contains the workflow managers and dynamic workflow definitions.
 * Internal mutations are in internal_mutations.ts.
 * Internal actions are in internal_actions.ts.
 */

import { WorkflowManager } from '@convex-dev/workflow';
import { v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { components } from '../_generated/api';
import * as EngineHelpers from './helpers/engine';

export const workflowManagers = [
  new WorkflowManager(components.workflow),
  new WorkflowManager(components.workflow_1),
  new WorkflowManager(components.workflow_2),
  new WorkflowManager(components.workflow_3),
];

export const workflowManager = workflowManagers[0];

const dynamicWorkflowDef = {
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
  handler: async (step: any, args: any): Promise<void> => {
    await EngineHelpers.handleDynamicWorkflow(step, args);
  },
};

export const dynamicWorkflow = workflowManagers[0].define(dynamicWorkflowDef);
export const dynamicWorkflow1 = workflowManagers[1].define(dynamicWorkflowDef);
export const dynamicWorkflow2 = workflowManagers[2].define(dynamicWorkflowDef);
export const dynamicWorkflow3 = workflowManagers[3].define(dynamicWorkflowDef);
