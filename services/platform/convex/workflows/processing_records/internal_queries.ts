import { v } from 'convex/values';

import { internalQuery } from '../../_generated/server';
import { getProcessingRecordById as getProcessingRecordByIdHelper } from './get_processing_record_by_id';

export const getProcessingRecordById = internalQuery({
  args: {
    processingRecordId: v.id('workflowProcessingRecords'),
  },
  handler: async (ctx, args) => {
    return await getProcessingRecordByIdHelper(ctx, args);
  },
});
