/**
 * Convex validators for workflows domain
 *
 * This file re-exports validators from sub-domain folders:
 * - definitions/validators.ts
 * - steps/validators.ts
 * - executions/validators.ts
 * - processing_records/validators.ts
 *
 * For now, it consolidates validators from the old structure.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';

// From wf_definitions
import {
  workflowStatusSchema,
  workflowTypeSchema,
  retryPolicySchema,
  secretConfigSchema,
  workflowConfigSchema,
  workflowUpdateSchema,
} from '../../lib/shared/schemas/wf_definitions';

// From wf_executions
import {
  executionSortOrderSchema,
  updateExecutionStatusArgsSchema,
  completeExecutionArgsSchema,
  failExecutionArgsSchema,
  patchExecutionArgsSchema,
  resumeExecutionArgsSchema,
  setComponentWorkflowArgsSchema,
  updateExecutionMetadataArgsSchema,
  updateExecutionVariablesArgsSchema,
  listExecutionsArgsSchema,
  listExecutionsPaginatedArgsSchema,
  listExecutionsCursorArgsSchema,
} from '../../lib/shared/schemas/wf_executions';

// From workflow_engine
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

// =============================================================================
// WORKFLOW DEFINITIONS VALIDATORS
// =============================================================================

export const workflowStatusValidator = zodToConvex(workflowStatusSchema);
export const workflowTypeValidator = zodToConvex(workflowTypeSchema);
export const retryPolicyValidator = zodToConvex(retryPolicySchema);
export const secretConfigValidator = zodToConvex(secretConfigSchema);
export const workflowConfigValidator = zodToConvex(workflowConfigSchema);
export const workflowUpdateValidator = zodToConvex(workflowUpdateSchema);

// =============================================================================
// WORKFLOW EXECUTIONS VALIDATORS
// =============================================================================

export const executionSortOrderValidator = zodToConvex(
  executionSortOrderSchema,
);
export const updateExecutionStatusArgsValidator = zodToConvex(
  updateExecutionStatusArgsSchema,
);
export const completeExecutionArgsValidator = zodToConvex(
  completeExecutionArgsSchema,
);
export const failExecutionArgsValidator = zodToConvex(failExecutionArgsSchema);
export const patchExecutionArgsValidator = zodToConvex(
  patchExecutionArgsSchema,
);
export const resumeExecutionArgsValidator = zodToConvex(
  resumeExecutionArgsSchema,
);
export const setComponentWorkflowArgsValidator = zodToConvex(
  setComponentWorkflowArgsSchema,
);
export const updateExecutionMetadataArgsValidator = zodToConvex(
  updateExecutionMetadataArgsSchema,
);
export const updateExecutionVariablesArgsValidator = zodToConvex(
  updateExecutionVariablesArgsSchema,
);
export const listExecutionsArgsValidator = zodToConvex(
  listExecutionsArgsSchema,
);
export const listExecutionsPaginatedArgsValidator = zodToConvex(
  listExecutionsPaginatedArgsSchema,
);
export const listExecutionsCursorArgsValidator = zodToConvex(
  listExecutionsCursorArgsSchema,
);

// =============================================================================
// WORKFLOW STEP DEFINITIONS VALIDATORS
// =============================================================================

export const stepTypeValidator = v.union(
  v.literal('trigger'),
  v.literal('llm'),
  v.literal('condition'),
  v.literal('action'),
  v.literal('loop'),
);

export const wfStepDefDocValidator = v.object({
  _id: v.id('wfStepDefs'),
  _creationTime: v.number(),
  organizationId: v.string(),
  wfDefinitionId: v.id('wfDefinitions'),
  stepSlug: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  stepType: stepTypeValidator,
  order: v.number(),
  nextSteps: v.record(v.string(), v.string()),
  config: stepConfigValidator,
  inputMapping: v.optional(v.record(v.string(), v.string())),
  outputMapping: v.optional(v.record(v.string(), v.string())),
  metadata: v.optional(jsonRecordValidator),
});

export const getOrderedStepsArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
};

export const listWorkflowStepsArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
};

export const createStepArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  stepSlug: v.string(),
  name: v.string(),
  stepType: stepTypeValidator,
  order: v.number(),
  config: stepConfigValidator,
  nextSteps: v.record(v.string(), v.string()),
  organizationId: v.string(),
};

export const deleteStepArgsValidator = {
  stepRecordId: v.id('wfStepDefs'),
};

export const updateStepArgsValidator = {
  stepRecordId: v.id('wfStepDefs'),
  updates: v.object({
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    order: v.optional(v.number()),
    config: v.optional(stepConfigValidator),
    nextSteps: v.optional(v.record(v.string(), v.string())),
    inputMapping: v.optional(v.record(v.string(), v.string())),
    outputMapping: v.optional(v.record(v.string(), v.string())),
    metadata: v.optional(jsonRecordValidator),
  }),
};
