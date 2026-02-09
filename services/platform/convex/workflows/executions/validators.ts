/**
 * Convex validators for workflow executions
 *
 * Note: Some schemas use jsonRecordSchema/jsonValueSchema which contain z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../../lib/shared/schemas/utils/json-value';
import {
  executionSortOrderSchema,
  updateExecutionStatusArgsSchema,
  failExecutionArgsSchema,
  patchExecutionArgsSchema,
  setComponentWorkflowArgsSchema,
  updateExecutionVariablesArgsSchema,
  listExecutionsArgsSchema,
  listExecutionsPaginatedArgsSchema,
  listExecutionsCursorArgsSchema,
} from '../../../lib/shared/schemas/wf_executions';

export {
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
} from '../../../lib/shared/schemas/wf_executions';

// Simple schemas without z.lazy()
export const executionSortOrderValidator = zodToConvex(
  executionSortOrderSchema,
);
export const updateExecutionStatusArgsValidator = zodToConvex(
  updateExecutionStatusArgsSchema,
);
export const failExecutionArgsValidator = zodToConvex(failExecutionArgsSchema);
export const patchExecutionArgsValidator = zodToConvex(
  patchExecutionArgsSchema,
);
export const setComponentWorkflowArgsValidator = zodToConvex(
  setComponentWorkflowArgsSchema,
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

// Complex schemas with jsonRecordSchema/jsonValueSchema (contains z.lazy) - use native Convex v
export const completeExecutionArgsValidator = v.object({
  executionId: v.string(),
  output: jsonValueValidator,
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.string()),
});

export const resumeExecutionArgsValidator = v.object({
  executionId: v.string(),
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});

export const updateExecutionMetadataArgsValidator = v.object({
  executionId: v.string(),
  metadata: jsonRecordValidator,
});
