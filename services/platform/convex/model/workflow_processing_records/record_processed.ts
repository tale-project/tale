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
  recordId: string;
  wfDefinitionId: string;
  recordCreationTime: number;
  metadata?: unknown;
}

export async function recordProcessed(
  ctx: MutationCtx,
  args: RecordProcessedArgs,
): Promise<Id<'workflowProcessingRecords'>> {
  const {
    organizationId,
    tableName,
    recordId,
    wfDefinitionId,
    recordCreationTime,
    metadata,
  } = args;

  // Check if this record has already been recorded for this workflow
  const existing = await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_record', (q) =>
      q
        .eq('tableName', tableName)
        .eq('recordId', recordId)
        .eq('wfDefinitionId', wfDefinitionId),
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
    recordId,
    wfDefinitionId,
    recordCreationTime,
    processedAt: Date.now(),
    metadata,
  });
}
