import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import type { TableName, RecordProcessedResult } from './types';

export async function recordProcessed(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    tableName: TableName;
    documentId: string;
    workflowId: string;
    documentCreationTime: number;
    metadata?: unknown;
  },
): Promise<RecordProcessedResult> {
  const recordId: Id<'workflowProcessingRecords'> = await ctx.runMutation(
    internal.workflow_processing_records.recordProcessed,
    {
      organizationId: params.organizationId,
      tableName: params.tableName,
      documentId: params.documentId,
      workflowId: params.workflowId,
      documentCreationTime: params.documentCreationTime,
      metadata: params.metadata,
    },
  );

  return {
    operation: 'record_processed',
    recordId,
    success: true,
    timestamp: Date.now(),
  };
}
