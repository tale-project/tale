/**
 * Types and validators for workflow step definitions
 */

import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';

// =============================================================================
// TypeScript Types
// =============================================================================

export type StepType = 'trigger' | 'llm' | 'condition' | 'action' | 'loop';

export interface CreateStepArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  stepSlug: string;
  name: string;
  stepType: StepType;
  order: number;
  config: unknown;
  nextSteps: Record<string, string>;
  organizationId: string;
}

export interface DeleteStepArgs {
  stepRecordId: Doc<'wfStepDefs'>['_id'];
}

export interface GetNextStepInSequenceArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  currentOrder: number;
}

export interface GetOrderedStepsArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
}

export interface GetStepByOrderArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  order: number;
}

export interface GetStepDefinitionArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  stepSlug: string;
}

export interface GetStepsByTypeArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  stepType: string;
}

export interface ListWorkflowStepsArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
}

export interface ReorderStepsArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  stepOrders: Array<{
    stepRecordId: Doc<'wfStepDefs'>['_id'];
    newOrder: number;
  }>;
}

export interface UpdateStepArgs {
  stepRecordId: Doc<'wfStepDefs'>['_id'];
  updates: unknown;
}

// =============================================================================
// Convex Validators
// =============================================================================

export const stepTypeValidator = v.union(
  v.literal('trigger'),
  v.literal('llm'),
  v.literal('condition'),
  v.literal('action'),
  v.literal('loop'),
);

export const createStepArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  stepSlug: v.string(),
  name: v.string(),
  stepType: stepTypeValidator,
  order: v.number(),
  config: v.any(),
  nextSteps: v.record(v.string(), v.string()),
  organizationId: v.string(),
};

export const deleteStepArgsValidator = {
  stepRecordId: v.id('wfStepDefs'),
};

export const getNextStepInSequenceArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  currentOrder: v.number(),
};

export const getOrderedStepsArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
};

export const getStepByOrderArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  order: v.number(),
};

export const getStepDefinitionArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  stepSlug: v.string(),
};

export const getStepsByTypeArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  stepType: v.string(),
};

export const listWorkflowStepsArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
};

export const reorderStepsArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  stepOrders: v.array(
    v.object({
      stepRecordId: v.id('wfStepDefs'),
      newOrder: v.number(),
    }),
  ),
};

export const updateStepArgsValidator = {
  stepRecordId: v.id('wfStepDefs'),
  updates: v.any(),
};
