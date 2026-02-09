import { v } from 'convex/values';

import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../../_generated/server';
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

export const recordProcessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: tableNameValidator,
    recordId: v.string(),
    wfDefinitionId: v.string(),
    recordCreationTime: v.number(),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await recordProcessedHelper(ctx, args);
  },
});
