/**
 * Atomically claim a record for processing by marking it as in_progress.
 *
 * This is used by find-and-lock style mutations to avoid multiple workflow
 * executions working on the same underlying record concurrently.
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { TableName } from './types';

export interface RecordClaimedArgs {
  organizationId: string;
  tableName: TableName;
  recordId: string;
  wfDefinitionId: string;
  recordCreationTime: number;
  metadata?: unknown;
}

export async function recordClaimed(
  ctx: MutationCtx,
  args: RecordClaimedArgs,
): Promise<Id<'workflowProcessingRecords'>> {
  const {
    organizationId,
    tableName,
    recordId,
    wfDefinitionId,
    recordCreationTime,
    metadata,
  } = args;

  const now = Date.now();

  // Check if this record already has a processing entry for this workflow
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
	    // Refresh the processing record and mark it as in_progress to indicate
	    // that this document is currently being worked on again.
	    await ctx.db.patch(existing._id, {
	      processedAt: now,
	      status: 'in_progress',
	      metadata,
	    });
	    return existing._id;
	  }

  // Create a new in_progress record for this workflow + record
  return await ctx.db.insert('workflowProcessingRecords', {
    organizationId,
    tableName,
    recordId,
    wfDefinitionId,
    recordCreationTime,
    processedAt: now,
    status: 'in_progress',
    metadata,
  });
}

