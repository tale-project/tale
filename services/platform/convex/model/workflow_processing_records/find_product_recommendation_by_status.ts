/**
 * Find product recommendation approvals by status.
 *
 * This is a general implementation that accepts status as a parameter.
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';
import { findUnprocessedWithCustomQuery } from './helpers/find_unprocessed_with_custom_query';

export interface FindProductRecommendationByStatusArgs {
  organizationId: string;
  workflowId: string;
  backoffHours: number; // Number of hours to look back for processing records
  status: 'pending' | 'approved' | 'rejected';
}

export interface FindProductRecommendationByStatusResult {
  approvals: Array<Doc<'approvals'>>;
  count: number;
}

/**
 * Find product recommendation approvals by status.
 *
 * This is a general operation that accepts status as a parameter,
 * allowing workflows to specify which status they want to query.
 *
 * Benefits:
 * - Single operation for all statuses
 * - More flexible for workflow configuration
 * - Less code duplication
 */
export async function findProductRecommendationByStatus(
  ctx: QueryCtx,
  args: FindProductRecommendationByStatusArgs,
): Promise<FindProductRecommendationByStatusResult> {
  const { organizationId, workflowId, backoffHours, status } = args;

  // Calculate cutoff timestamp from backoffHours
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - backoffHours);
  const cutoffTimestamp = cutoffDate.toISOString();

  const result = await findUnprocessedWithCustomQuery<Doc<'approvals'>>(ctx, {
    organizationId,
    tableName: 'approvals',
    workflowId,
    cutoffTimestamp,

    // Build query with the specified status
    buildQuery: (resumeFrom) => {
      // Use the by_org_status_resourceType index for efficient querying
      // _creationTime is automatically indexed in every Convex index
      return resumeFrom
        ? ctx.db
            .query('approvals')
            .withIndex('by_org_status_resourceType', (q) =>
              q
                .eq('organizationId', organizationId)
                .eq('status', status)
                .eq('resourceType', 'product_recommendation')
                .gt('_creationTime', resumeFrom),
            )
        : ctx.db
            .query('approvals')
            .withIndex('by_org_status_resourceType', (q) =>
              q
                .eq('organizationId', organizationId)
                .eq('status', status)
                .eq('resourceType', 'product_recommendation'),
            );
    },
  });

  return {
    approvals: result.documents,
    count: result.count,
  };
}

