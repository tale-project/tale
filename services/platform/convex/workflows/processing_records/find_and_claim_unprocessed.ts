/**
 * Find and claim a single unprocessed document with a custom query builder.
 *
 * Handles all boilerplate: resume point optimization, processing status checks,
 * additional filters, and atomic claiming/locking.
 *
 * @example
 * ```typescript
 * const result = await findAndClaimUnprocessed(ctx, {
 *   organizationId,
 *   tableName: 'conversations',
 *   wfDefinitionId,
 *   cutoffTimestamp,
 *   buildQuery: (resumeFrom) => {
 *     return resumeFrom
 *       ? ctx.db.query('conversations')
 *           .withIndex('by_organizationId_and_status', q =>
 *             q.eq('organizationId', organizationId)
 *              .eq('status', 'open')
 *              .gt('_creationTime', resumeFrom))
 *       : ctx.db.query('conversations')
 *           .withIndex('by_organizationId_and_status', q =>
 *             q.eq('organizationId', organizationId).eq('status', 'open'));
 *   },
 *   additionalFilter: async (conv) => {
 *     const latestMsg = await getLatestConversationMessage(ctx, conv._id);
 *     return latestMsg?.direction === 'inbound';
 *   }
 * });
 * ```
 */

import type { MutationCtx } from '../../_generated/server';

import { getLatestProcessedCreationTime } from './get_latest_processed_creation_time';
import { recordClaimed } from './record_claimed';
import { runQuery } from './run_query';
import {
  FindAndClaimUnprocessedArgs,
  FindAndClaimUnprocessedResult,
} from './types';

export async function findAndClaimUnprocessed<T = unknown>(
  ctx: MutationCtx,
  args: FindAndClaimUnprocessedArgs<T>,
): Promise<FindAndClaimUnprocessedResult<T>> {
  const { organizationId, tableName, wfDefinitionId } = args;

  // Get the resume point
  const resumeFrom = await getLatestProcessedCreationTime(ctx, {
    organizationId,
    tableName,
    wfDefinitionId,
  });

  // Try starting from the latest processed creation time
  let [foundDocument] = await runQuery<T>(ctx, args, resumeFrom, 1);

  // If nothing found and we had a resume point, fall back to a full scan.
  // This lets backoffHours re-surface older entities once their processing
  // records are older than the cutoffTimestamp.
  if (!foundDocument && resumeFrom !== null) {
    [foundDocument] = await runQuery<T>(ctx, args, null, 1);
  }

  if (!foundDocument) {
    return { document: null };
  }

  const typed = foundDocument as T & { _id: unknown; _creationTime?: number };
  if (!typed._id) {
    console.warn('Found document missing _id, skipping claim', {
      tableName,
      wfDefinitionId,
    });
    return { document: null };
  }

  // Best-effort claim - if it fails, return null so it can be retried later
  try {
    await recordClaimed(ctx, {
      organizationId,
      tableName,
      recordId: String(typed._id),
      wfDefinitionId,
      recordCreationTime: typed._creationTime ?? Date.now(),
      metadata: undefined,
    });
    return { document: foundDocument };
  } catch (error) {
    console.error('Failed to claim workflow processing record', {
      tableName,
      recordId: String(typed._id),
      wfDefinitionId,
      error,
    });
    return { document: null };
  }
}
