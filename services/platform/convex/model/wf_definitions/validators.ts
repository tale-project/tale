/**
 * Convex validators for workflow definitions
 */

import { v } from 'convex/values';

export const workflowStatusValidator = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('archived'),
);

export const workflowTypeValidator = v.literal('predefined');

export const workflowConfigValidator = v.object({
  timeout: v.optional(v.number()),
  retryPolicy: v.optional(
    v.object({
      maxRetries: v.number(),
      backoffMs: v.number(),
    }),
  ),
  variables: v.optional(v.record(v.string(), v.any())),
  secrets: v.optional(
    v.record(
      v.string(),
      v.object({
        kind: v.literal('inlineEncrypted'),
        cipherText: v.string(),
        keyId: v.optional(v.string()),
      }),
    ),
  ),
});

export const workflowUpdateValidator = v.object({
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  version: v.optional(v.string()),
  status: v.optional(v.string()),
  workflowType: v.optional(workflowTypeValidator),
  config: v.optional(workflowConfigValidator),
  metadata: v.optional(v.any()),
});
