/**
 * Record that a document has been processed by a workflow.
 * This should be called after successfully processing a document.
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { TableName } from './types';

export interface RecordProcessedArgs {
  organizationId: string;
  tableName: TableName;
  documentId: string;
  workflowId: string;
  documentCreationTime: number;
  metadata?: unknown;
}

export async function recordProcessed(
  ctx: MutationCtx,
  args: RecordProcessedArgs,
): Promise<Id<'workflowProcessingRecords'>> {
  const {
    organizationId,
    tableName,
    documentId,
    workflowId,
    documentCreationTime,
    metadata,
  } = args;

  // Check if this document has already been recorded for this workflow
  const existing = await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_document', (q) =>
      q
        .eq('tableName', tableName)
        .eq('documentId', documentId)
        .eq('workflowId', workflowId),
    )
    .first();

  if (existing) {
    // Update existing record
    await ctx.db.patch(existing._id, {
      processedAt: Date.now(),
      metadata,
    });
    return existing._id;
  }

  // Create new record
  return await ctx.db.insert('workflowProcessingRecords', {
    organizationId,
    tableName,
    documentId,
    workflowId,
    documentCreationTime,
    processedAt: Date.now(),
    metadata,
  });
}
