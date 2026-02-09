/**
 * Find and claim a single unprocessed document with smart index selection.
 *
 * This function automatically:
 * 1. Parses the filterExpression to extract indexable conditions
 * 2. Selects the optimal database index based on conditions
 * 3. Builds the query using the selected index
 * 4. Applies any remaining filter conditions as post-filters
 *
 * @example
 * // Find any unprocessed conversation
 * findUnprocessed(ctx, { tableName: 'conversations', ... })
 *
 * @example
 * // Find closed conversations older than 30 days
 * findUnprocessed(ctx, {
 *   tableName: 'conversations',
 *   filterExpression: 'status == "closed" && daysAgo(metadata.resolved_at) > 30',
 *   ...
 * })
 */

import type { MutationCtx } from '../../../_generated/server';
import type { FindUnprocessedArgs, FindUnprocessedResult } from './types';

import { calculateCutoffTimestamp } from '../calculate_cutoff_timestamp';
import { findAndClaimUnprocessed } from '../find_and_claim_unprocessed';
import { selectOptimalIndex } from '../index_selection';
import { createExpressionFilter } from './create_expression_filter';
import { createQueryBuilder } from './create_query_builder';

export async function findUnprocessed(
  ctx: MutationCtx,
  args: FindUnprocessedArgs,
): Promise<FindUnprocessedResult> {
  const {
    organizationId,
    tableName,
    wfDefinitionId,
    backoffHours,
    filterExpression,
  } = args;

  const cutoffTimestamp = calculateCutoffTimestamp(backoffHours);

  // Select optimal index based on filter expression
  const { index, indexValues, requiresPostFilter } = selectOptimalIndex(
    tableName,
    organizationId,
    filterExpression,
  );

  // Build query using the selected index
  const buildQuery = createQueryBuilder(
    ctx,
    tableName,
    index.name,
    indexValues,
  );

  // Create additional filter if post-filtering is needed
  const additionalFilter =
    requiresPostFilter && filterExpression
      ? createExpressionFilter(filterExpression)
      : undefined;

  return await findAndClaimUnprocessed(ctx, {
    organizationId,
    tableName,
    wfDefinitionId,
    cutoffTimestamp,
    buildQuery,
    additionalFilter,
  });
}
