/**
 * Convex validators for workflow executions
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
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

export const executionSortOrderValidator = zodToConvex(executionSortOrderSchema);
export const updateExecutionStatusArgsValidator = zodToConvex(updateExecutionStatusArgsSchema);
export const completeExecutionArgsValidator = zodToConvex(completeExecutionArgsSchema);
export const failExecutionArgsValidator = zodToConvex(failExecutionArgsSchema);
export const patchExecutionArgsValidator = zodToConvex(patchExecutionArgsSchema);
export const resumeExecutionArgsValidator = zodToConvex(resumeExecutionArgsSchema);
export const setComponentWorkflowArgsValidator = zodToConvex(setComponentWorkflowArgsSchema);
export const updateExecutionMetadataArgsValidator = zodToConvex(updateExecutionMetadataArgsSchema);
export const updateExecutionVariablesArgsValidator = zodToConvex(updateExecutionVariablesArgsSchema);
export const listExecutionsArgsValidator = zodToConvex(listExecutionsArgsSchema);
export const listExecutionsPaginatedArgsValidator = zodToConvex(listExecutionsPaginatedArgsSchema);
export const listExecutionsCursorArgsValidator = zodToConvex(listExecutionsCursorArgsSchema);
