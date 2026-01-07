/**
 * Type definitions for workflow step definitions
 */

import type { Infer } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { stepTypeValidator } from './validators';
import type { StepConfig } from '../../workflow/types/nodes';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type StepType = Infer<typeof stepTypeValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export interface CreateStepArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  stepSlug: string;
  name: string;
  stepType: StepType;
  order: number;
  config: StepConfig;
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
