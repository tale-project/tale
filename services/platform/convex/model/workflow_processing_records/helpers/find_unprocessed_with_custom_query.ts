/**
 * Find unprocessed documents with a custom query builder.
 *
 * This is a generic function that handles all the boilerplate of:
 * - Getting the resume point
 * - Building queries with resume optimization
 * - Checking processing status
 * - Applying additional filters
 *
 * You only need to provide:
 * 1. A query builder function (with your custom index)
 * 2. Optional additional filter logic
 *
 * @example
 * ```typescript
 * // Find unprocessed open conversations with inbound messages
 * const result = await findUnprocessedWithCustomQuery(ctx, {
 *   organizationId,
 *   tableName: 'conversations',
 *   workflowId,
 *   cutoffTimestamp,
 *   limit: 10,
 *   buildQuery: (resumeFrom) => {
 *     // Use .gt() directly in the index query for better performance
 *     // _creationTime is automatically indexed in every Convex index
 *     return resumeFrom
 *       ? ctx.db
 *           .query('conversations')
 *           .withIndex('by_organizationId_and_status', q =>
 *             q.eq('organizationId', organizationId)
 *              .eq('status', 'open')
 *              .gt('_creationTime', resumeFrom)
 *           )
 *       : ctx.db
 *           .query('conversations')
 *           .withIndex('by_organizationId_and_status', q =>
 *             q.eq('organizationId', organizationId).eq('status', 'open')
 *           );
 *   },
 *   additionalFilter: async (conv) => {
 *     const latestMsg = await getLatestConversationMessage(ctx, conv._id);
 *     return latestMsg?.direction === 'inbound';
 *   }
 * });
 * ```
 */

import { QueryCtx } from '../../../_generated/server';
import {
  FindUnprocessedWithCustomQueryArgs,
  FindUnprocessedWithCustomQueryResult,
} from '../types';
import { getLatestProcessedCreationTime } from './get_latest_processed_creation_time';
import { runQuery } from './run_query';

/**
 * Generic function to find unprocessed documents with custom query logic.
 *
 * This abstracts away all the boilerplate while giving you full control over:
 * - Which index to use
 * - What filters to apply
 * - Additional custom logic
 */
export async function findUnprocessedWithCustomQuery<T = unknown>(
  ctx: QueryCtx,
  args: FindUnprocessedWithCustomQueryArgs<T>,
): Promise<FindUnprocessedWithCustomQueryResult<T>> {
  const { organizationId, tableName, workflowId } = args;
  const limitVal = args.limit ?? 1;

  if (limitVal < 1 || limitVal > 10) {
    throw new Error('limit must be between 1 and 10');
  }

  const documents: T[] = [];

  // Step 1: Get the resume point (handled automatically)
  const resumeFrom = await getLatestProcessedCreationTime(ctx, {
    organizationId,
    tableName,
    workflowId,
  });

  // First, try starting from the latest processed creation time (resumeFrom)
  const firstPassDocs = await runQuery<T>(ctx, args, resumeFrom, limitVal);
  documents.push(...firstPassDocs);

  // If we didn't find anything and we had a resume point, fall back to a full scan
  // starting from the beginning. This lets backoffHours re-surface older entities
  // once their processing records are older than the cutoffTimestamp.
  if (documents.length === 0 && resumeFrom !== null) {
    const remainingLimit = limitVal - documents.length;
    if (remainingLimit > 0) {
      const secondPassDocs = await runQuery<T>(ctx, args, null, remainingLimit);
      documents.push(...secondPassDocs);
    }
  }

  return {
    documents,
    count: documents.length,
  };
}
