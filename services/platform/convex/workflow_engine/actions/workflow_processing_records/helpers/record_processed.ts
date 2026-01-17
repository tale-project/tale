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
    metadata?: unknown;
  },
): Promise<RecordProcessedResult> {
  const processingRecordId: Id<'workflowProcessingRecords'> =
    await ctx.runMutation(
      internal.mutations.workflow_processing_records.recordProcessed,
      {
        organizationId: params.organizationId,
        tableName: params.tableName,
        recordId: params.recordId,
        wfDefinitionId: params.wfDefinitionId,
        recordCreationTime: Date.now(), // Auto-populated
        metadata: params.metadata,
      },
    );

  // Fetch and return the full created entity
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  const createdRecord = await ctx.runQuery(
    internal.queries.workflow_processing_records.getProcessingRecordById,
    { processingRecordId },
  );

  if (!createdRecord) {
    throw new Error(
      `Failed to retrieve processing record with ID "${processingRecordId}" after creation`,
    );
  }

  return createdRecord;
}
