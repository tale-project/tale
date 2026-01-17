import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';

export type GetProcessingRecordByIdArgs = {
  processingRecordId: Id<'workflowProcessingRecords'>;
};

/**
 * Get a workflow processing record by its ID.
 */
export async function getProcessingRecordById(
  ctx: QueryCtx,
  args: GetProcessingRecordByIdArgs,
): Promise<Doc<'workflowProcessingRecords'> | null> {
  return await ctx.db.get(args.processingRecordId);
}

