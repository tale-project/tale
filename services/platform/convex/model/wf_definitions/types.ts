/**
 * Type definitions for workflow definitions
 */

import type { Infer } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
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
