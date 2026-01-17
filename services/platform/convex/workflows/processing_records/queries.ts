/**
 * Workflow Processing Records Queries
 *
 * Internal queries for workflow processing record operations.
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { getProcessingRecordById as getProcessingRecordByIdHelper } from './get_processing_record_by_id';

/**
 * Get a processing record by ID (internal query)
 */
export const getProcessingRecordById = internalQuery({
  args: {
    processingRecordId: v.id('workflowProcessingRecords'),
  },
  handler: async (ctx, args) => {
    return await getProcessingRecordByIdHelper(ctx, args);
  },
});
