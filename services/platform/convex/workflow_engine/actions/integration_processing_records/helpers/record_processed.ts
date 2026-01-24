/**
 * Mark integration records as processed
 *
 * This module handles recording the completion status of external records.
 */

import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { ProcessingRecord, IntegrationProcessingMetadata } from '../types';
import { createIntegrationTableName } from './create_integration_table_name';

/**
 * Parameters for recording a processed integration record
 */
export interface RecordProcessedParams {
  organizationId: string;
  wfDefinitionId: string;
  integration: string;
  tag: string;
  recordId: string;
  /**
   * Optional metadata to store with the processing record.
   * Can include resume point for incremental strategies.
   */
  metadata?: IntegrationProcessingMetadata;
}

/**
 * Record that an integration record has been processed
 *
 * @param ctx - Action context
 * @param params - Record processed parameters
 * @returns The created/updated processing record
 */
export async function recordProcessed(
  ctx: ActionCtx,
  params: RecordProcessedParams,
): Promise<ProcessingRecord> {
  const { organizationId, wfDefinitionId, integration, tag, recordId, metadata } = params;

  const tableName = createIntegrationTableName(integration, tag);

  const processingRecordId = await ctx.runMutation(
    internal.integration_processing_records.recordProcessed,
    {
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      recordCreationTime: Date.now(),
      metadata,
    },
  );

  const createdRecord = await ctx.runQuery(
    internal.integration_processing_records.getProcessingRecordById,
    { processingRecordId },
  );

  if (!createdRecord) {
    throw new Error(
      `Failed to retrieve processing record with ID "${processingRecordId}" after creation`,
    );
  }

  return createdRecord as ProcessingRecord;
}
