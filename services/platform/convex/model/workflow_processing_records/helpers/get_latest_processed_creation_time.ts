/**
 * Get the _creationTime of the latest processed record for a workflow.
 *
 * This is useful for resume optimization - you can start your query from this point
 * instead of scanning from the beginning.
 *
 * @example
 * ```typescript
 * // Get resume point
 * const resumeFrom = await getLatestProcessedCreationTime(ctx, {
 *   organizationId,
 *   tableName: 'conversations',
 *   wfDefinitionId
 * });
 *
 * // Build query with resume point
 * const query = resumeFrom
 *   ? ctx.db.query('conversations')
 *       .withIndex('by_organizationId_and_status', q =>
 *         q.eq('organizationId', orgId)
 *          .eq('status', 'open')
 *          .gt('_creationTime', resumeFrom)
 *       )
 *   : ctx.db.query('conversations')
 *       .withIndex('by_organizationId_and_status', q =>
 *         q.eq('organizationId', orgId).eq('status', 'open')
 *       );
 * ```
 */

import { QueryCtx } from '../../../_generated/server';

import { TableName } from '../types';

export interface GetLatestProcessedCreationTimeArgs {
  organizationId: string;
  tableName: TableName;
  wfDefinitionId: string;
}

export async function getLatestProcessedCreationTime(
  ctx: QueryCtx,
  args: GetLatestProcessedCreationTimeArgs,
): Promise<number | null> {
  const { organizationId, tableName, wfDefinitionId } = args;

  // Get the latest processed record for this workflow+table
  const latestProcessed = await ctx.db
    .query('workflowProcessingRecords')
    .withIndex('by_org_table_wfDefinition_creationTime', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('tableName', tableName)
        .eq('wfDefinitionId', wfDefinitionId),
    )
    .order('desc')
    .first();

  return latestProcessed?.recordCreationTime ?? null;
}
