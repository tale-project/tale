/**
 * Convex validators for workflow step definitions
 * These are backend-only validators that depend on workflow-specific types
 */

import { v } from 'convex/values';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

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
