import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { TableName, RecordProcessedResult } from './types';

export async function recordProcessed(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    tableName: TableName;
    recordId: string;
    wfDefinitionId: string;
    recordCreationTime: number;
    metadata?: unknown;
  },
): Promise<RecordProcessedResult> {
  const processingRecordId: Id<'workflowProcessingRecords'> =
    await ctx.runMutation(
      internal.workflow_processing_records.recordProcessed,
      {
        organizationId: params.organizationId,
        tableName: params.tableName,
        recordId: params.recordId,
        wfDefinitionId: params.wfDefinitionId,
        recordCreationTime: params.recordCreationTime,
        metadata: params.metadata,
      },
    );

  return {
    operation: 'record_processed',
    recordId: processingRecordId,
    success: true,
    timestamp: Date.now(),
  };
}
