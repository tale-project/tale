/**
 * Convex validators for workflows domain
 *
 * This file re-exports validators from sub-domain folders:
 * - definitions/validators.ts
 * - steps/validators.ts
 * - executions/validators.ts
 * - processing_records/validators.ts
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
// From workflow_engine
import { stepConfigValidator } from '../workflow_engine/types/nodes';

// =============================================================================
// WORKFLOW DEFINITIONS VALIDATORS (re-export from definitions/validators.ts)
// =============================================================================

export {
  workflowStatusValidator,
  workflowTypeValidator,
  retryPolicyValidator,
  secretConfigValidator,
  workflowConfigValidator,
  workflowUpdateValidator,
} from './definitions/validators';

// =============================================================================
// WORKFLOW EXECUTIONS VALIDATORS (re-export from executions/validators.ts)
// =============================================================================

export {
  executionSortOrderValidator,
  updateExecutionStatusArgsValidator,
  completeExecutionArgsValidator,
  failExecutionArgsValidator,
  patchExecutionArgsValidator,
  resumeExecutionArgsValidator,
  setComponentWorkflowArgsValidator,
  updateExecutionMetadataArgsValidator,
  updateExecutionVariablesArgsValidator,
  listExecutionsArgsValidator,
  listExecutionsCursorArgsValidator,
} from './executions/validators';

// =============================================================================
// WORKFLOW STEP DEFINITIONS VALIDATORS
// =============================================================================

export const stepTypeValidator = v.union(
  v.literal('start'),
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
