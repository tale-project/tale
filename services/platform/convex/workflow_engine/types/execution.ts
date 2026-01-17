/**
 * Workflow execution types
 */

import type { Doc } from '../../_generated/dataModel';

/**
 * Workflow execution with deserialized variables.
 * NOTE: This is only used for single-execution detail queries (getExecutionById).
 * The listExecutions query now returns raw Doc<'wfExecutions'> to let the
 * frontend handle JSON.parse for heavy fields.
 */
export type DeserializedWorkflowExecution = Omit<
  Doc<'wfExecutions'>,
  'variables' | 'workflowConfig' | 'stepsConfig'
> & {
  variables: Record<string, unknown>;
  workflowConfig?: Record<string, unknown>;
  stepsConfig?: Record<string, unknown>;
};
