/**
 * Convex validators for workflow definitions
 * Generated from shared Zod schemas using zodToConvex
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  workflowStatusSchema,
  workflowTypeSchema,
  retryPolicySchema,
  secretConfigSchema,
  workflowConfigSchema,
  workflowUpdateSchema,
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

export const workflowStatusValidator = zodToConvex(workflowStatusSchema);
export const workflowTypeValidator = zodToConvex(workflowTypeSchema);
export const retryPolicyValidator = zodToConvex(retryPolicySchema);
export const secretConfigValidator = zodToConvex(secretConfigSchema);
export const workflowConfigValidator = zodToConvex(workflowConfigSchema);
export const workflowUpdateValidator = zodToConvex(workflowUpdateSchema);

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
