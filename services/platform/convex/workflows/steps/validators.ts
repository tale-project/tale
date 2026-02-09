/**
 * Convex validators for workflow step definitions
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { stepConfigValidator } from '../../workflow_engine/types/nodes';

export const stepTypeValidator = v.union(
  v.literal('start'),
  v.literal('trigger'),
  v.literal('llm'),
  v.literal('condition'),
  v.literal('action'),
  v.literal('loop'),
);

export const editModeValidator = v.union(
  v.literal('visual'),
  v.literal('json'),
  v.literal('ai'),
);

export const stepDefValidator = v.object({
  organizationId: v.string(),
  wfDefinitionId: v.id('wfDefinitions'),
  stepSlug: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  stepType: stepTypeValidator,
  order: v.number(),
  nextSteps: v.record(v.string(), v.string()),
  config: stepConfigValidator,
  inputMapping: v.optional(v.record(v.string(), v.string())),
  outputMapping: v.optional(v.record(v.string(), v.string())),
  metadata: v.optional(jsonRecordValidator),
});
