/**
 * Check if a record has been processed by a workflow since the cutoff timestamp.
 *
 * This helper allows you to write custom index queries and then check processing status
 * for individual records during iteration.
 *
 * @example
 * ```typescript
 * // Query with proper index
 * for await (const conv of ctx.db
 *   .query('conversations')
 *   .withIndex('by_organizationId_and_status', q =>
 *     q.eq('organizationId', orgId).eq('status', 'open')
 *   )
 * ) {
 *   // Check if processed
 *   const isProcessed = await isRecordProcessed(ctx, {
 *     tableName: 'conversations',
 *     recordId: String(conv._id),
 *     wfDefinitionId,
 *     cutoffTimestamp
 *   });
 *
 *   if (!isProcessed) {
 *     // Process this record
 *   }
 * }
 * ```
 */

import { QueryCtx } from '../../_generated/server';
import { TableName } from './types';

export interface IsRecordProcessedArgs {
  tableName: TableName;
  recordId: string;
  wfDefinitionId: string;
  cutoffTimestamp: string; // ISO date string
}

export async function isRecordProcessed(
  ctx: QueryCtx,
  args: IsRecordProcessedArgs,
): Promise<boolean> {
  const { tableName, recordId, wfDefinitionId, cutoffTimestamp } = args;

  // Convert cutoffTimestamp to milliseconds
  const cutoffMs = new Date(cutoffTimestamp).getTime();

  // Check if this record has been processed since the cutoff
  const processedRecord = await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_record', (q) =>
      q
        .eq('tableName', tableName)
        .eq('recordId', recordId)
        .eq('wfDefinitionId', wfDefinitionId),
    )
    .first();

  if (!processedRecord) {
    return false;
  }

  // Record is "processed" if it was touched after cutoff.
  // Status can be 'in_progress' (claimed by another execution) or 'completed'.
  // Either way, this execution should skip the record.
  return processedRecord.processedAt >= cutoffMs;
}
