/**
 * Mark an external integration record as processed and advance the
 * per-workflow incremental watermark.
 *
 * Watermark semantics: the watermark advances ONLY here (on completion),
 * never at claim time — a failed run can never skip records. Advancement is
 * monotonic: an out-of-order completion with an older incremental value
 * leaves the stored watermark untouched. Boundary re-fetches caused by
 * inclusive `>=` resume semantics are absorbed by the dedupe rows.
 */

import { isRecord } from '../../../lib/utils/type-utils';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { ConvexJsonRecord } from '../../lib/validators/json';
import {
  getIntegrationSyncState,
  isIntegrationSyncStrategy,
  upsertIntegrationSyncState,
  type IntegrationSyncStrategy,
} from './integration_sync_state';
import {
  SYNC_STATE_RECORD_ID,
  type IntegrationTableName,
} from './integration_table_name';
import { recordProcessed } from './record_processed';

export interface RecordIntegrationProcessedArgs {
  organizationId: string;
  tableName: IntegrationTableName;
  recordId: string;
  wfDefinitionId: string;
  /**
   * Watermark value for this record. Falls back to the value captured in the
   * claim metadata at find time when omitted.
   */
  incrementalValue?: string | number;
  metadata?: ConvexJsonRecord;
}

function toComparableNumber(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * True when `candidate` is strictly greater than `current`. Numeric compare
 * when both sides are numeric (epoch ms, numeric ids — including numeric
 * strings coming out of workflow template interpolation), lexicographic
 * fallback otherwise.
 */
export function isIncrementalValueGreater(
  candidate: string | number,
  current: string | number | undefined,
): boolean {
  if (current === undefined) {
    return true;
  }
  const candidateNumber = toComparableNumber(candidate);
  const currentNumber = toComparableNumber(current);
  if (candidateNumber !== null && currentNumber !== null) {
    return candidateNumber > currentNumber;
  }
  return String(candidate) > String(current);
}

export async function recordIntegrationProcessed(
  ctx: MutationCtx,
  args: RecordIntegrationProcessedArgs,
): Promise<Id<'workflowProcessingRecords'>> {
  const { organizationId, tableName, recordId, wfDefinitionId } = args;

  if (recordId === SYNC_STATE_RECORD_ID) {
    throw new Error(
      `recordId "${SYNC_STATE_RECORD_ID}" is reserved for integration sync state and cannot be recorded as processed`,
    );
  }

  // Read the claim row first: its metadata carries the strategy and the
  // incremental value captured at find time.
  const existingClaim = await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_record', (q) =>
      q
        .eq('tableName', tableName)
        .eq('recordId', recordId)
        .eq('wfDefinitionId', wfDefinitionId),
    )
    .first();

  const claimMetadata: Record<string, unknown> = isRecord(
    existingClaim?.metadata,
  )
    ? existingClaim.metadata
    : {};

  let strategy: IntegrationSyncStrategy | null = null;
  if (isIntegrationSyncStrategy(claimMetadata.strategy)) {
    strategy = claimMetadata.strategy;
  }

  let incrementalValue: string | number | undefined = args.incrementalValue;
  if (
    incrementalValue === undefined &&
    (typeof claimMetadata.incrementalValue === 'string' ||
      typeof claimMetadata.incrementalValue === 'number')
  ) {
    incrementalValue = claimMetadata.incrementalValue;
  }

  // Preserve claim bookkeeping (strategy, incrementalValue) for
  // observability; caller-provided metadata wins on key collisions.
  const userMetadata: Record<string, unknown> = isRecord(args.metadata)
    ? args.metadata
    : {};
  const mergedMetadata = { ...claimMetadata, ...userMetadata };

  const processingRecordId = await recordProcessed(ctx, {
    organizationId,
    tableName,
    recordId,
    wfDefinitionId,
    recordCreationTime: existingClaim?.recordCreationTime ?? Date.now(),
    metadata:
      Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
  });

  // Advance the watermark monotonically for incremental strategies.
  if (
    (strategy === 'timestamp_based' || strategy === 'id_based') &&
    incrementalValue !== undefined
  ) {
    const key = { organizationId, tableName, wfDefinitionId };
    const syncState = await getIntegrationSyncState(ctx, key);

    if (!syncState || syncState.strategy !== strategy) {
      // First completion, or the workflow definition switched strategies:
      // (re)initialize the sync state for the active strategy.
      await upsertIntegrationSyncState(ctx, key, {
        strategy,
        watermark: incrementalValue,
      });
    } else if (
      isIncrementalValueGreater(incrementalValue, syncState.watermark)
    ) {
      await upsertIntegrationSyncState(ctx, key, {
        ...syncState,
        watermark: incrementalValue,
      });
    }
  }

  return processingRecordId;
}
