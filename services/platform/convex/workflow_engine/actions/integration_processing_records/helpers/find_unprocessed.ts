/**
 * Find unprocessed records from external integrations
 *
 * This module implements the core logic for:
 * 1. Fetching data from external integrations (SQL/REST)
 * 2. Applying local JEXL filters
 * 3. Checking processing status against workflowProcessingRecords
 * 4. Claiming unprocessed records (up to the specified limit)
 *
 * Returns an array of claimed records or null if no unprocessed records found.
 * Throws an error if claiming fails (e.g., race condition with another workflow).
 */

import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import { jexlInstance } from '../../../../lib/variables/jexl_instance';
import { integrationAction } from '../../integration/integration_action';
import type {
  CursorConfig,
  FindStrategy,
  FindStrategyParams,
  FindUnprocessedResult,
  IntegrationProcessingMetadata,
} from '../types';
import { createIntegrationTableName } from './create_integration_table_name';
import { extractRecordId } from './extract_record_id';
import { getNestedValue } from './get_nested_value';
import { buildFetchParams, extractNextResumePoint, type ResumePoint } from './build_fetch_params';
import { BACKOFF_NEVER_REPROCESS } from '../../../../workflows/processing_records/constants';

/**
 * Sort records by cursor field in ascending order
 *
 * This ensures consistent processing order regardless of how the external
 * system returns data. Records are processed from oldest to newest (for
 * timestamp/id strategies), which allows resume points to work correctly.
 */
function sortRecordsByCursor(
  records: Record<string, unknown>[],
  strategy: FindStrategy,
  cursorConfig: CursorConfig | undefined,
): Record<string, unknown>[] {
  // find_all and find_by_cursor don't need sorting
  // - find_all: no cursor field to sort by
  // - find_by_cursor: pagination order is controlled by external API
  if (strategy === 'find_all' || strategy === 'find_by_cursor' || !cursorConfig) {
    return records;
  }

  const field = cursorConfig.field;

  return [...records].sort((a, b) => {
    const aValue = getNestedValue(a, field);
    const bValue = getNestedValue(b, field);

    // Handle null/undefined - push them to the end
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;

    // Compare based on type
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return aValue - bValue;
    }

    // String comparison (works for ISO dates, date strings, and string IDs)
    return String(aValue).localeCompare(String(bValue));
  });
}

/**
 * Parameters for finding unprocessed integration records
 */
export type FindUnprocessedParams = FindStrategyParams & {
  organizationId: string;
  wfDefinitionId: string;
};

/**
 * Calculate the cutoff timestamp based on backoffHours
 */
function calculateCutoffTimestamp(backoffHours: number): string {
  if (backoffHours === BACKOFF_NEVER_REPROCESS) {
    // Use a far future date to never consider records for reprocessing
    return new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  }

  const cutoffMs = Date.now() - backoffHours * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

/**
 * Get the resume point for incremental fetching
 */
async function getResumePoint(
  ctx: ActionCtx,
  tableName: string,
  wfDefinitionId: string,
  strategy: string,
): Promise<ResumePoint | null> {
  // Query the latest processing record for this integration source
  const latestRecord = await ctx.runQuery(
    internal.integration_processing_records.getLatestProcessedForIntegration,
    { tableName, wfDefinitionId },
  );

  if (!latestRecord) {
    return null;
  }

  // Extract resume point from metadata
  const metadata = latestRecord.metadata as IntegrationProcessingMetadata | undefined;
  if (!metadata?.resumePoint) {
    return null;
  }

  return {
    value: metadata.resumePoint,
    strategy: metadata.strategy || strategy,
  } as ResumePoint;
}

/**
 * Atomically check and claim a record for processing.
 *
 * This prevents race conditions by combining the "check if processed" and
 * "claim" operations into a single atomic mutation.
 *
 * @returns true if claimed successfully, false if already processed or claim failed
 */
async function checkAndClaimRecord(
  ctx: ActionCtx,
  organizationId: string,
  tableName: string,
  recordId: string,
  wfDefinitionId: string,
  cutoffTimestamp: string,
  metadata: IntegrationProcessingMetadata,
): Promise<boolean> {
  try {
    const result = await ctx.runMutation(
      internal.integration_processing_records.checkAndClaimRecord,
      {
        organizationId,
        tableName,
        recordId,
        wfDefinitionId,
        recordCreationTime: Date.now(),
        cutoffTimestamp,
        metadata,
      },
    );
    return result !== null;
  } catch (error) {
    console.error('Failed to check and claim integration processing record', {
      tableName,
      recordId,
      wfDefinitionId,
      error,
    });
    return false;
  }
}

/**
 * Extract records array from integration fetch result
 */
function extractRecordsFromResult(fetchResult: unknown): Record<string, unknown>[] {
  if (!fetchResult || typeof fetchResult !== 'object') {
    return [];
  }

  const result = (fetchResult as { result?: unknown }).result;

  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }

  if (result && typeof result === 'object') {
    const resultObj = result as Record<string, unknown>;
    if (Array.isArray(resultObj.data)) return resultObj.data as Record<string, unknown>[];
    if (Array.isArray(resultObj.records)) return resultObj.records as Record<string, unknown>[];
    if (Array.isArray(resultObj.items)) return resultObj.items as Record<string, unknown>[];
  }

  return [];
}

/**
 * Extract cursor for cursor-based pagination
 */
function extractCursorFromResponse(
  fetchResult: unknown,
  strategy: string,
  cursorConfig: CursorConfig | undefined,
): string | number | null {
  if (strategy !== 'find_by_cursor' || !fetchResult || !cursorConfig) {
    return null;
  }

  const resultObj = (fetchResult as { result?: Record<string, unknown> }).result;
  if (!resultObj || typeof resultObj !== 'object') {
    return null;
  }

  // Try the configured field first, then fall back to common cursor field names
  const cursorField = cursorConfig.field;
  return (
    (resultObj[cursorField] as string | number) ??
    (resultObj.nextCursor as string | number) ??
    (resultObj.page_info as string | number) ??
    (resultObj.cursor as string | number) ??
    null
  );
}

/**
 * Apply local JEXL filter to a record
 */
function applyLocalFilter(record: Record<string, unknown>, filterExpression: string): boolean {
  try {
    const context = {
      ...record,
      now: new Date().toISOString(),
      nowMs: Date.now(),
    };
    return Boolean(jexlInstance.evalSync(filterExpression, context));
  } catch (error) {
    console.error('Local filter expression evaluation error:', {
      filterExpression,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Find and claim unprocessed records from an external integration
 *
 * This function:
 * 1. Builds fetch parameters with resume point injection
 * 2. Calls the integration to fetch external data
 * 3. Applies local JEXL filtering (if configured)
 * 4. Iterates through results, checking processing status
 * 5. Claims and returns unprocessed records (up to the specified limit)
 *
 * @throws Error if claiming a record fails (to abort workflow and retry later)
 */
export async function findUnprocessed(
  ctx: ActionCtx,
  params: FindUnprocessedParams,
): Promise<FindUnprocessedResult<Record<string, unknown>>> {
  const { organizationId, wfDefinitionId } = params;

  // Extract common fields
  const strategy = params.strategy as FindStrategy;
  const integration = params.integration;
  const action = params.action;
  const actionParams = params.params as Record<string, unknown> | undefined;
  const uniqueKey = params.uniqueKey;
  const tag = params.tag;
  const filter = params.filter;
  const backoffHours = params.backoffHours;
  const limit = 'limit' in params && typeof params.limit === 'number' ? params.limit : 1;

  // Extract cursor config (not present in find_all strategy)
  const cursorConfig: CursorConfig | undefined =
    'cursor' in params ? (params.cursor as CursorConfig) : undefined;

  const tableName = createIntegrationTableName(integration, tag);
  const cutoffTimestamp = calculateCutoffTimestamp(backoffHours);
  const resumePoint = await getResumePoint(ctx, tableName, wfDefinitionId, strategy);
  const finalFetchParams = buildFetchParams(actionParams, resumePoint, strategy, cursorConfig);

  // Fetch data from integration
  let fetchResult: unknown;
  try {
    fetchResult = await integrationAction.execute(
      ctx,
      {
        name: integration,
        operation: action,
        params: finalFetchParams,
        skipApprovalCheck: true, // Read operations don't need approval
      },
      { organizationId },
    );
  } catch (error) {
    console.error('Integration fetch failed:', {
      integration,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const records = extractRecordsFromResult(fetchResult);
  if (records.length === 0) {
    return null;
  }

  const nextCursor = extractCursorFromResponse(fetchResult, strategy, cursorConfig);
  const nextResumePoint = extractNextResumePoint(records, strategy, cursorConfig, nextCursor);

  // Sort records to ensure consistent processing order (oldest first)
  const sortedRecords = sortRecordsByCursor(records, strategy, cursorConfig);

  const claimedRecords: Record<string, unknown>[] = [];

  for (const record of sortedRecords) {
    // Stop if we've reached the limit
    if (claimedRecords.length >= limit) {
      break;
    }

    const recordId = extractRecordId(record, uniqueKey);
    if (!recordId) {
      console.warn('Could not extract record ID, skipping record:', {
        uniqueKey,
        record,
      });
      continue;
    }

    if (filter && !applyLocalFilter(record, filter)) {
      continue;
    }

    const metadata: IntegrationProcessingMetadata = {
      resumePoint: nextResumePoint ?? undefined,
      strategy,
      originalData: record,
    };

    // Atomically check if record is available and claim it
    const claimed = await checkAndClaimRecord(
      ctx,
      organizationId,
      tableName,
      recordId,
      wfDefinitionId,
      cutoffTimestamp,
      metadata,
    );

    if (!claimed) {
      // Claim failed - abort workflow to retry later
      throw new Error(
        `Failed to claim record ${recordId} for ${tableName}. ` +
          `Record may have been claimed by another workflow execution.`,
      );
    }

    claimedRecords.push(record);
  }

  return claimedRecords.length > 0 ? claimedRecords : null;
}
