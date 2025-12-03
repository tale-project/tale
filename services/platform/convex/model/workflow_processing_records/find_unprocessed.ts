/**
 * Find unprocessed documents in a table for a specific workflow.
 *
 * Algorithm:
 * 1. Get the latest processed document's _creationTime (resume point)
 * 2. Get the latest document in the target table
 * 3. Determine starting point:
 *    - If no processing history exists: start from the beginning
 *    - If latest processed == latest in table: we've caught up, start from beginning to find any missed docs
 *    - Otherwise: resume from where we left off (documents with _creationTime > last processed)
 * 4. Iterate through candidates and check each document's processing status
 *
 * Why this works:
 * - Documents are ordered by _creationTime (immutable, monotonically increasing)
 * - We track the _creationTime of the last processed document as a "bookmark"
 * - Starting from this bookmark, we only scan documents created after it
 * - For each candidate, we check if it was processed since the cutoff timestamp
 * - This handles edge cases:
 *   * Documents that were skipped (e.g., failed processing)
 *   * Documents processed by other workflow runs
 *   * Reprocessing after cutoff period expires
 *
 * Benefits:
 * - Avoids scanning all documents (uses resume point optimization)
 * - Uses indexes efficiently (by_organizationId with _creationTime range)
 * - Tracks processing progress per workflow per table
 * - Can resume from where it left off
 * - Handles concurrent workflow executions safely
 */

import { QueryCtx } from '../../_generated/server';

import { TableName } from './types';
import { findUnprocessedWithCustomQuery } from './helpers/find_unprocessed_with_custom_query';

export interface FindUnprocessedArgs {
  organizationId: string;
  tableName: TableName;
  wfDefinitionId: string;
  backoffHours: number; // Number of hours to look back for processing records
  limit?: number;
}

export interface FindUnprocessedResult {
  documents: Array<unknown>;
  count: number;
}

/**
 * Simple wrapper around findUnprocessedWithCustomQuery that uses the basic by_organizationId index.
 *
 * This is a convenience function for the most common use case.
 * For custom queries with different indexes, use findUnprocessedWithCustomQuery directly.
 */
export async function findUnprocessed(
  ctx: QueryCtx,
  args: FindUnprocessedArgs,
): Promise<FindUnprocessedResult> {
  const { organizationId, tableName, wfDefinitionId, backoffHours, limit } =
    args;

  // Calculate cutoff timestamp from backoffHours
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - backoffHours);
  const cutoffTimestamp = cutoffDate.toISOString();

  // Use the hook mechanism with the basic by_organizationId index
  const result = await findUnprocessedWithCustomQuery(ctx, {
    organizationId,
    tableName,
    wfDefinitionId,
    cutoffTimestamp,
    limit,

    // Build query using the basic by_organizationId index
    buildQuery: (resumeFrom) => {
      return resumeFrom
        ? ctx.db
            .query(tableName)
            .withIndex('by_organizationId', (q) =>
              q
                .eq('organizationId', organizationId)
                .gt('_creationTime', resumeFrom),
            )
            .order('asc')
        : ctx.db
            .query(tableName)
            .withIndex('by_organizationId', (q) =>
              q.eq('organizationId', organizationId),
            )
            .order('asc');
    },

    // No additional filter - just check processing status
  });

  return result;
}
