/**
 * Convex validators for workflows domain
 *
 * This file re-exports validators from sub-domain folders:
 * - definitions/validators.ts
 * - steps/validators.ts
 * - executions/validators.ts
 * - processing_records/validators.ts
 */

import { v } from 'convex/values';

import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../lib/validators/json';

// =============================================================================
// WORKFLOW DEFINITIONS VALIDATORS
// =============================================================================

export const workflowStatusValidator = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('archived'),
);

export const workflowTypeValidator = v.literal('predefined');

export const retryPolicyValidator = v.object({
  maxRetries: v.number(),
  backoffMs: v.number(),
});

export const secretConfigValidator = v.object({
  kind: v.literal('inlineEncrypted'),
  cipherText: v.string(),
  keyId: v.optional(v.string()),
});

export const workflowConfigValidator = v.optional(
  v.object({
    timeout: v.optional(v.number()),
    retryPolicy: v.optional(retryPolicyValidator),
    variables: v.optional(v.record(v.string(), jsonValueValidator)),
    secrets: v.optional(v.record(v.string(), secretConfigValidator)),
  }),
);

export const workflowUpdateValidator = v.object({
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  config: v.optional(workflowConfigValidator),
  metadata: v.optional(jsonRecordValidator),
});

// =============================================================================
// WORKFLOW EXECUTIONS VALIDATORS (re-export from executions/validators.ts)
// =============================================================================

export {
  executionSortOrderValidator,
  updateExecutionStatusArgsValidator,
  completeExecutionArgsValidator,
  failExecutionArgsValidator,
  patchExecutionArgsValidator,
  resumeExecutionArgsValidator,
  setComponentWorkflowArgsValidator,
  updateExecutionMetadataArgsValidator,
  updateExecutionVariablesArgsValidator,
  listExecutionsArgsValidator,
  listExecutionsCursorArgsValidator,
} from './executions/validators';
