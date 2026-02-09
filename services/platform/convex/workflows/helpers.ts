/**
 * Workflows domain helpers
 *
 * Re-exports types and business logic from workflow execution models.
 * The workflows domain is complex with 4 related tables:
 * - wfDefinitions
 * - wfStepDefs
 * - wfExecutions
 * - workflowProcessingRecords
 *
 * This file serves as a facade to the underlying model implementations.
 */

// Re-export execution helpers
export { failExecution } from './executions/fail_execution';
export { updateExecutionMetadata } from './executions/update_execution_metadata';

// Re-export types
export type {
  FailExecutionArgs,
  UpdateExecutionMetadataArgs,
} from './executions/types';
