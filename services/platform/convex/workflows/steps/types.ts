/**
 * Type definitions for workflow step definitions
 */

import type { Doc } from '../../_generated/dataModel';
import type { StepConfig } from '../../workflow_engine/types/nodes';

// =============================================================================
// TYPES
// =============================================================================

export type StepType = 'start' | 'trigger' | 'llm' | 'condition' | 'action' | 'loop';

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

export interface GetOrderedStepsArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
}

export interface ListWorkflowStepsArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
}

export interface UpdateStepArgs {
  stepRecordId: Doc<'wfStepDefs'>['_id'];
  updates: unknown;
}
