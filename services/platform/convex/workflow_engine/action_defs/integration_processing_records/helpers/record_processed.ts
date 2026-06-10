import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { ConvexJsonRecord } from '../../../../lib/validators/json';
import { createIntegrationTableName } from '../../../../workflows/processing_records/integration_table_name';
import type { ProcessingRecord } from '../../workflow_processing_records/helpers/types';

export interface RecordProcessedIntegrationArgs {
  organizationId: string;
  wfDefinitionId: string;
  integrationName: string;
  sourceIdentifier: string;
  recordId: string;
  /**
   * Watermark value from the find_unprocessed envelope. Falls back to the
   * value captured at claim time when omitted.
   */
  incrementalValue?: string | number;
  metadata?: ConvexJsonRecord;
}

export async function recordProcessedIntegration(
  ctx: ActionCtx,
  args: RecordProcessedIntegrationArgs,
): Promise<ProcessingRecord> {
  const tableName = createIntegrationTableName(
    args.integrationName,
    args.sourceIdentifier,
  );

  const processingRecordId: Id<'workflowProcessingRecords'> =
    await ctx.runMutation(
      internal.workflows.processing_records.internal_mutations
        .recordIntegrationProcessed,
      {
        organizationId: args.organizationId,
        tableName,
        recordId: args.recordId,
        wfDefinitionId: args.wfDefinitionId,
        incrementalValue: args.incrementalValue,
        metadata: args.metadata,
      },
    );

  // Fetch and return the full created entity.
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  const createdRecord = await ctx.runQuery(
    internal.workflows.processing_records.internal_queries
      .getProcessingRecordById,
    { processingRecordId },
  );

  if (!createdRecord) {
    throw new Error(
      `Failed to retrieve processing record with ID "${processingRecordId}" after creation`,
    );
  }

  return createdRecord;
}
