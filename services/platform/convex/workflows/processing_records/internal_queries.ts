import { v } from 'convex/values';

import { internalQuery } from '../../_generated/server';
import { getProcessingRecordById as getProcessingRecordByIdHelper } from './get_processing_record_by_id';
import {
  getIntegrationSyncState as getIntegrationSyncStateHelper,
  type IntegrationSyncState,
} from './integration_sync_state';
import { isIntegrationTableName } from './integration_table_name';

export const getProcessingRecordById = internalQuery({
  args: {
    processingRecordId: v.id('workflowProcessingRecords'),
  },
  handler: async (ctx, args) => {
    return await getProcessingRecordByIdHelper(ctx, args);
  },
});

export const getIntegrationSyncState = internalQuery({
  args: {
    organizationId: v.string(),
    tableName: v.string(),
    wfDefinitionId: v.string(),
  },
  handler: async (ctx, args): Promise<IntegrationSyncState | null> => {
    const { tableName } = args;
    if (!isIntegrationTableName(tableName)) {
      throw new Error(
        `getIntegrationSyncState requires an integration table name ("integration:<name>:<source>"), got "${tableName}"`,
      );
    }
    return await getIntegrationSyncStateHelper(ctx, { ...args, tableName });
  },
});
