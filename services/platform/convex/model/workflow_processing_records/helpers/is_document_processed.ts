/**
 * Check if a document has been processed by a workflow since the cutoff timestamp.
 *
 * This helper allows you to write custom index queries and then check processing status
 * for individual documents during iteration.
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
 *   const isProcessed = await isDocumentProcessed(ctx, {
 *     tableName: 'conversations',
 *     documentId: String(conv._id),
 *     workflowId,
 *     cutoffTimestamp
 *   });
 *
 *   if (!isProcessed) {
 *     // Process this document
 *   }
 * }
 * ```
 */

import { QueryCtx } from '../../../_generated/server';
import { TableName } from '../types';

export interface IsDocumentProcessedArgs {
  tableName: TableName;
  documentId: string;
  workflowId: string;
  cutoffTimestamp: string; // ISO date string
}

export async function isDocumentProcessed(
  ctx: QueryCtx,
  args: IsDocumentProcessedArgs,
): Promise<boolean> {
  const { tableName, documentId, workflowId, cutoffTimestamp } = args;

  // Convert cutoffTimestamp to milliseconds
  const cutoffMs = new Date(cutoffTimestamp).getTime();

  // Check if this document has been processed since the cutoff
  const processedRecord = await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_document', (q) =>
      q
        .eq('tableName', tableName)
        .eq('documentId', documentId)
        .eq('workflowId', workflowId),
    )
    .first();

  // Document is processed if a record exists and was processed after cutoff
  return processedRecord !== null && processedRecord.processedAt >= cutoffMs;
}
