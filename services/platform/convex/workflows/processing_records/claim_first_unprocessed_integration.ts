/**
 * Atomically claim the first unprocessed external record from a fetched page.
 *
 * The action layer fetches a page from the integration, filters it locally and
 * passes only lightweight candidates `{ recordId, recordCreationTime,
 * incrementalValue? }` (never full payloads — Convex argument-size safety).
 * This helper runs inside ONE mutation, so the processed-check + claim are
 * serializable: two concurrent workflow executions can never claim the same
 * record.
 *
 * Cursor semantics (`cursor_based` strategy): the stored cursor advances ONLY
 * when a page contains zero unprocessed records — passing `advanceCursorTo`
 * persists the next-page cursor in the same transaction iff nothing was
 * claimed. A failed run can therefore never skip records.
 */

import type { MutationCtx } from '../../_generated/server';
import { calculateCutoffTimestamp } from './calculate_cutoff_timestamp';
import {
  upsertIntegrationSyncState,
  type IntegrationSyncStrategy,
} from './integration_sync_state';
import {
  SYNC_STATE_RECORD_ID,
  type IntegrationTableName,
} from './integration_table_name';
import { isRecordProcessed } from './is_record_processed';
import { recordClaimed } from './record_claimed';

export interface IntegrationClaimCandidate {
  recordId: string;
  recordCreationTime: number;
  /**
   * Watermark value captured at fetch time (normalized epoch ms for
   * `timestamp_based`, the id for `id_based`). Stored in the claim metadata so
   * `record_processed` can advance the watermark even when the workflow does
   * not pass it back explicitly.
   */
  incrementalValue?: string | number;
}

export interface ClaimFirstUnprocessedIntegrationArgs {
  organizationId: string;
  tableName: IntegrationTableName;
  wfDefinitionId: string;
  backoffHours: number;
  /** Candidates in fetch order — the first unprocessed one gets claimed. */
  candidates: IntegrationClaimCandidate[];
  /** Strategy recorded in the claim metadata for watermark advancement. */
  strategy?: IntegrationSyncStrategy;
  /** Next-page cursor, persisted only when this page is fully processed. */
  advanceCursorTo?: string;
}

export interface ClaimFirstUnprocessedIntegrationResult {
  claimedRecordId: string | null;
  /** True when every candidate on the page was already processed/claimed. */
  allProcessed: boolean;
}

export async function claimFirstUnprocessedIntegration(
  ctx: MutationCtx,
  args: ClaimFirstUnprocessedIntegrationArgs,
): Promise<ClaimFirstUnprocessedIntegrationResult> {
  const {
    organizationId,
    tableName,
    wfDefinitionId,
    backoffHours,
    candidates,
    strategy,
    advanceCursorTo,
  } = args;

  const cutoffTimestamp = calculateCutoffTimestamp(backoffHours);

  for (const candidate of candidates) {
    if (candidate.recordId === SYNC_STATE_RECORD_ID) {
      console.warn(
        `[integration_processing_records] skipping external record with reserved id "${SYNC_STATE_RECORD_ID}"`,
        { tableName },
      );
      continue;
    }

    const processed = await isRecordProcessed(ctx, {
      tableName,
      recordId: candidate.recordId,
      wfDefinitionId,
      cutoffTimestamp,
    });
    if (processed) {
      continue;
    }

    const metadata: Record<string, string | number> = {};
    if (strategy !== undefined) {
      metadata.strategy = strategy;
    }
    if (candidate.incrementalValue !== undefined) {
      metadata.incrementalValue = candidate.incrementalValue;
    }

    await recordClaimed(ctx, {
      organizationId,
      tableName,
      recordId: candidate.recordId,
      wfDefinitionId,
      recordCreationTime: candidate.recordCreationTime,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    return { claimedRecordId: candidate.recordId, allProcessed: false };
  }

  // Page exhausted with nothing claimable — safe to advance the cursor.
  if (advanceCursorTo !== undefined) {
    await upsertIntegrationSyncState(
      ctx,
      { organizationId, tableName, wfDefinitionId },
      { strategy: 'cursor_based', cursor: advanceCursorTo },
    );
  }

  return { claimedRecordId: null, allProcessed: true };
}
