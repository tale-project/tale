/**
 * Find and claim a single unprocessed document using the basic by_organizationId index.
 *
 * This is a convenience wrapper around findAndClaimUnprocessed for the most common use case.
 * For custom queries with different indexes, use findAndClaimUnprocessed directly.
 */

import type { MutationCtx } from '../../_generated/server';
import { TableName } from './types';
import { calculateCutoffTimestamp } from './calculate_cutoff_timestamp';
import { findAndClaimUnprocessed } from './find_and_claim_unprocessed';

export interface FindUnprocessedArgs {
  organizationId: string;
  tableName: TableName;
  wfDefinitionId: string;
  backoffHours: number;
}

export interface FindUnprocessedResult {
  document: unknown | null;
}

export async function findUnprocessed(
  ctx: MutationCtx,
  args: FindUnprocessedArgs,
): Promise<FindUnprocessedResult> {
  const { organizationId, tableName, wfDefinitionId, backoffHours } = args;

  const cutoffTimestamp = calculateCutoffTimestamp(backoffHours);

  return await findAndClaimUnprocessed(ctx, {
    organizationId,
    tableName,
    wfDefinitionId,
    cutoffTimestamp,
    buildQuery: (resumeFrom) =>
      resumeFrom
        ? ctx.db
            .query(tableName)
            .withIndex('by_organizationId', (q) =>
              q.eq('organizationId', organizationId).gt('_creationTime', resumeFrom),
            )
            .order('asc')
        : ctx.db
            .query(tableName)
            .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
            .order('asc'),
  });
}
