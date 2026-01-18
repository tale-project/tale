/**
 * Convex validators for workflow definitions
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod4';
import {
  workflowStatusSchema,
  workflowTypeSchema,
  retryPolicySchema,
  secretConfigSchema,
} from '../../../lib/shared/schemas/wf_definitions';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

export {
  workflowStatusSchema,
  workflowTypeSchema,
  retryPolicySchema,
  secretConfigSchema,
  workflowConfigSchema,
  workflowUpdateSchema,
} from '../../../lib/shared/schemas/wf_definitions';

// Simple schemas without z.lazy()
export const workflowStatusValidator = zodToConvex(workflowStatusSchema);
export const workflowTypeValidator = zodToConvex(workflowTypeSchema);
export const retryPolicyValidator = zodToConvex(retryPolicySchema);
export const secretConfigValidator = zodToConvex(secretConfigSchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const workflowConfigValidator = v.object({
  timeout: v.optional(v.number()),
  retryPolicy: v.optional(retryPolicyValidator),
  variables: v.optional(jsonRecordValidator),
  secrets: v.optional(v.record(v.string(), secretConfigValidator)),
});

export const workflowUpdateValidator = v.object({
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  version: v.optional(v.string()),
  status: v.optional(workflowStatusValidator),
  workflowType: v.optional(workflowTypeValidator),
  config: v.optional(workflowConfigValidator),
  metadata: v.optional(jsonRecordValidator),
});

export const userRequirementValidator = v.object({
  goal: v.string(),
  context: v.optional(v.string()),
  constraints: v.optional(v.array(v.string())),
  expectedOutcome: v.optional(v.string()),
});

export const plannerConfigValidator = v.object({
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
});

export const workflowDefinitionValidator = v.object({
  organizationId: v.string(),
  version: v.string(),
  versionNumber: v.number(),
  status: v.string(),
  workflowType: workflowTypeValidator,
  name: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  config: v.optional(workflowConfigValidator),
  rootVersionId: v.optional(v.id('wfDefinitions')),
  parentVersionId: v.optional(v.id('wfDefinitions')),
  publishedAt: v.optional(v.number()),
  publishedBy: v.optional(v.string()),
  changeLog: v.optional(v.string()),
  userRequirement: v.optional(userRequirementValidator),
  availableAgentTypes: v.optional(v.array(v.string())),
  globalConfig: v.optional(jsonRecordValidator),
  plannerConfig: v.optional(plannerConfigValidator),
  metadata: v.optional(jsonRecordValidator),
});
