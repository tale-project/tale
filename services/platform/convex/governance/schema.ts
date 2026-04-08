import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const GOVERNANCE_POLICY_TYPES = [
  'system_prompt',
  'budgets',
  'upload_policy',
  'retention_policy',
  'feature_flags',
  'pii_config',
  'default_models',
] as const;

const policyTypeValidator = v.union(
  ...GOVERNANCE_POLICY_TYPES.map((t) => v.literal(t)),
);

export const governancePoliciesTable = defineTable({
  organizationId: v.string(),
  policyType: policyTypeValidator,
  config: jsonRecordValidator,
  updatedBy: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_org_policyType', ['organizationId', 'policyType']);

export const usageLedgerTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  teamId: v.optional(v.string()),
  periodKey: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  estimatedCostEur: v.number(),
  estimatedCostUsd: v.number(),
  requestCount: v.number(),
})
  .index('by_org_user_period', ['organizationId', 'userId', 'periodKey'])
  .index('by_org_team_period', ['organizationId', 'teamId', 'periodKey'])
  .index('by_org_period', ['organizationId', 'periodKey']);
