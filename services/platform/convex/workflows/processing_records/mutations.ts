/**
 * Workflow Processing Records Mutations
 *
 * Internal mutations for workflow processing record operations.
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { jsonValueValidator } from '../../../lib/shared/schemas/utils/json-value';
import { findUnprocessed as findUnprocessedHelper } from './query_building/find_unprocessed';
import { recordProcessed as recordProcessedHelper } from './record_processed';

const tableNameValidator = v.union(
  v.literal('customers'),
  v.literal('products'),
  v.literal('documents'),
  v.literal('conversations'),
  v.literal('conversationMessages'),
  v.literal('approvals'),
  v.literal('onedriveSyncConfigs'),
  v.literal('websitePages'),
  v.literal('exampleMessages'),
);

/**
 * Find and claim a single unprocessed document (internal mutation)
 */
export const findUnprocessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: tableNameValidator,
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
    filterExpression: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await findUnprocessedHelper(ctx, args);
  },
});

/**
 * Record that a document has been processed (internal mutation)
 */
export const recordProcessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: tableNameValidator,
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    metadata: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    return await recordProcessedHelper(ctx, args);
  },
});
