/**
 * Convex validators for workflow definitions
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/validators/json';

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
  status: workflowStatusValidator,
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
