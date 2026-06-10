import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { jsonRecordValidator } from '../../lib/validators/json';
import { claimFirstUnprocessedIntegration as claimFirstUnprocessedIntegrationHelper } from './claim_first_unprocessed_integration';
import { upsertIntegrationSyncState as upsertIntegrationSyncStateHelper } from './integration_sync_state';
import { isIntegrationTableName } from './integration_table_name';
import { findUnprocessed as findUnprocessedHelper } from './query_building/find_unprocessed';
import { recordIntegrationProcessed as recordIntegrationProcessedHelper } from './record_integration_processed';
import { recordProcessed as recordProcessedHelper } from './record_processed';

const tableNameValidator = v.union(
  v.literal('customers'),
  v.literal('products'),
  v.literal('documents'),
  v.literal('conversations'),
  v.literal('conversationMessages'),
  v.literal('approvals'),
  v.literal('onedriveSyncConfigs'),
);

const syncStrategyValidator = v.union(
  v.literal('timestamp_based'),
  v.literal('cursor_based'),
  v.literal('id_based'),
  v.literal('full_scan'),
);

const incrementalValueValidator = v.union(v.string(), v.number());

function assertIntegrationTableName(
  tableName: string,
  functionName: string,
): asserts tableName is `integration:${string}:${string}` {
  if (!isIntegrationTableName(tableName)) {
    throw new Error(
      `${functionName} requires an integration table name ("integration:<name>:<source>"), got "${tableName}"`,
    );
  }
}

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

export const claimFirstUnprocessedIntegration = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.string(),
    wfDefinitionId: v.string(),
    backoffHours: v.number(),
    candidates: v.array(
      v.object({
        recordId: v.string(),
        recordCreationTime: v.number(),
        incrementalValue: v.optional(incrementalValueValidator),
      }),
    ),
    strategy: v.optional(syncStrategyValidator),
    advanceCursorTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { tableName } = args;
    assertIntegrationTableName(tableName, 'claimFirstUnprocessedIntegration');
    return await claimFirstUnprocessedIntegrationHelper(ctx, {
      ...args,
      tableName,
    });
  },
});

export const recordIntegrationProcessed = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.string(),
    recordId: v.string(),
    wfDefinitionId: v.string(),
    incrementalValue: v.optional(incrementalValueValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const { tableName } = args;
    assertIntegrationTableName(tableName, 'recordIntegrationProcessed');
    return await recordIntegrationProcessedHelper(ctx, {
      ...args,
      tableName,
    });
  },
});

export const upsertIntegrationSyncState = internalMutation({
  args: {
    organizationId: v.string(),
    tableName: v.string(),
    wfDefinitionId: v.string(),
    strategy: syncStrategyValidator,
    watermark: v.optional(incrementalValueValidator),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { tableName } = args;
    assertIntegrationTableName(tableName, 'upsertIntegrationSyncState');
    await upsertIntegrationSyncStateHelper(
      ctx,
      {
        organizationId: args.organizationId,
        tableName,
        wfDefinitionId: args.wfDefinitionId,
      },
      {
        strategy: args.strategy,
        watermark: args.watermark,
        cursor: args.cursor,
      },
    );
  },
});
