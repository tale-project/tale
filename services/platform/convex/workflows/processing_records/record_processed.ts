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

  const now = Date.now();
  if (existing) {
    // Transition existing record to completed state
    await ctx.db.patch(existing._id, {
      processedAt: now,
      status: 'completed',
      metadata,
    });
    return existing._id;
  }

  // Create new record in completed state (backwards-compatible path when no claim exists)
  return await ctx.db.insert('workflowProcessingRecords', {
    organizationId,
    tableName,
    recordId,
    wfDefinitionId,
    recordCreationTime,
    processedAt: now,
    status: 'completed',
    metadata,
  });
}
