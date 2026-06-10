/**
 * Per-workflow sync state for integration data sources.
 *
 * The watermark/cursor for incremental fetching is stored in a sentinel row in
 * `workflowProcessingRecords` with `recordId = SYNC_STATE_RECORD_ID`, keyed by
 * `(tableName, recordId, wfDefinitionId)` via the existing `by_record` index.
 * Keeping it in the same table makes claim + cursor advancement transactional
 * inside one Convex mutation without any schema change.
 *
 * IMPORTANT: every other integration-path read over this table must exclude
 * `SYNC_STATE_RECORD_ID` — the sentinel is bookkeeping, not a processed record.
 */

import { isRecord } from '../../../lib/utils/type-guards';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import {
  SYNC_STATE_RECORD_ID,
  type IntegrationTableName,
} from './integration_table_name';

export type IntegrationSyncStrategy =
  | 'timestamp_based'
  | 'cursor_based'
  | 'id_based'
  | 'full_scan';

const SYNC_STRATEGIES: ReadonlySet<string> = new Set([
  'timestamp_based',
  'cursor_based',
  'id_based',
  'full_scan',
]);

export interface IntegrationSyncState {
  strategy: IntegrationSyncStrategy;
  /**
   * Resume watermark. For `timestamp_based` this is the normalized epoch-ms
   * value of the highest processed record; for `id_based` the highest
   * processed id (number, or string for non-numeric ids).
   */
  watermark?: string | number;
  /** Opaque pagination cursor for `cursor_based`. */
  cursor?: string;
}

export interface IntegrationSyncStateKey {
  organizationId: string;
  tableName: IntegrationTableName;
  wfDefinitionId: string;
}

export function isIntegrationSyncStrategy(
  value: unknown,
): value is IntegrationSyncStrategy {
  return typeof value === 'string' && SYNC_STRATEGIES.has(value);
}

function parseSyncStateMetadata(
  metadata: unknown,
): IntegrationSyncState | null {
  if (!isRecord(metadata)) {
    return null;
  }
  if (!isIntegrationSyncStrategy(metadata.strategy)) {
    console.warn(
      '[integration_processing_records] sync-state row has an unknown strategy; ignoring stored state',
      { strategy: metadata.strategy },
    );
    return null;
  }
  const state: IntegrationSyncState = { strategy: metadata.strategy };
  if (
    typeof metadata.watermark === 'string' ||
    typeof metadata.watermark === 'number'
  ) {
    state.watermark = metadata.watermark;
  }
  if (typeof metadata.cursor === 'string' && metadata.cursor !== '') {
    state.cursor = metadata.cursor;
  }
  return state;
}

async function findSyncStateRow(
  ctx: QueryCtx,
  key: IntegrationSyncStateKey,
): Promise<Doc<'workflowProcessingRecords'> | null> {
  return await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_record', (q) =>
      q
        .eq('tableName', key.tableName)
        .eq('recordId', SYNC_STATE_RECORD_ID)
        .eq('wfDefinitionId', key.wfDefinitionId),
    )
    .first();
}

export async function getIntegrationSyncState(
  ctx: QueryCtx,
  key: IntegrationSyncStateKey,
): Promise<IntegrationSyncState | null> {
  const row = await findSyncStateRow(ctx, key);
  if (!row) {
    return null;
  }
  if (row.organizationId !== key.organizationId) {
    console.warn(
      '[integration_processing_records] sync-state row organization mismatch; ignoring stored state',
      { tableName: key.tableName, wfDefinitionId: key.wfDefinitionId },
    );
    return null;
  }
  return parseSyncStateMetadata(row.metadata);
}

/**
 * Replace the stored sync state wholesale. Omitted `watermark`/`cursor` are
 * dropped, which is how a stale cursor gets cleared.
 */
export async function upsertIntegrationSyncState(
  ctx: MutationCtx,
  key: IntegrationSyncStateKey,
  syncState: IntegrationSyncState,
): Promise<void> {
  const metadata: Record<string, string | number> = {
    strategy: syncState.strategy,
  };
  if (syncState.watermark !== undefined) {
    metadata.watermark = syncState.watermark;
  }
  if (syncState.cursor !== undefined) {
    metadata.cursor = syncState.cursor;
  }

  const existing = await findSyncStateRow(ctx, key);
  if (existing && existing.organizationId !== key.organizationId) {
    throw new Error(
      `Sync-state row for "${key.tableName}" / "${key.wfDefinitionId}" belongs to a different organization — refusing to overwrite`,
    );
  }
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { metadata, processedAt: now });
    return;
  }

  await ctx.db.insert('workflowProcessingRecords', {
    organizationId: key.organizationId,
    tableName: key.tableName,
    recordId: SYNC_STATE_RECORD_ID,
    wfDefinitionId: key.wfDefinitionId,
    // Sentinel: keep it before all real records for creation-time ordering.
    recordCreationTime: 0,
    processedAt: now,
    status: 'completed',
    metadata,
  });
}
