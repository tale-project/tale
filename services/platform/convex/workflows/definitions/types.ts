/**
 * Type definitions for workflow definitions
 */

import type { Infer } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { StepConfig } from '../../workflow_engine/types/nodes';
import type { StepType } from '../steps/types';

import {
  workflowConfigValidator,
  workflowStatusValidator,
  workflowTypeValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type WorkflowStatus = Infer<typeof workflowStatusValidator>;
export type WorkflowType = Infer<typeof workflowTypeValidator>;
export type WorkflowConfig = Infer<typeof workflowConfigValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export type WorkflowDefinition = Doc<'wfDefinitions'>;

export interface WorkflowDefinitionWithFirstStep extends WorkflowDefinition {
  firstStepSlug: string | null;
}

export interface PublishDraftResult {
  activeVersionId: Id<'wfDefinitions'>;
}

export interface ActivateVersionResult {
  activeVersionId: Id<'wfDefinitions'>;
  newDraftId: Id<'wfDefinitions'>;
}

// =============================================================================
// API PAYLOAD TYPES (strict types matching handler validators)
// =============================================================================

/**
 * Strict type for workflow config passed to createWorkflowWithSteps handler.
 * Matches the Convex validator exactly.
 */
export interface CreateWorkflowPayload {
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: WorkflowType;
    config?: WorkflowConfig;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: StepType;
    order: number;
    config: StepConfig;
    nextSteps: Record<string, string>;
  }>;
}
