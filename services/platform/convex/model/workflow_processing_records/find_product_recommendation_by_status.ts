/**
 * Find and claim a single product recommendation approval by status.
 */

import { MutationCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';
import { findAndClaimUnprocessed } from './find_and_claim_unprocessed';

export interface FindProductRecommendationByStatusArgs {
  organizationId: string;
  wfDefinitionId: string;
  backoffHours: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface FindProductRecommendationByStatusResult {
  approval: Doc<'approvals'> | null;
}

export async function findProductRecommendationByStatus(
  ctx: MutationCtx,
  args: FindProductRecommendationByStatusArgs,
): Promise<FindProductRecommendationByStatusResult> {
  const { organizationId, wfDefinitionId, backoffHours, status } = args;

  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - backoffHours);
  const cutoffTimestamp = cutoffDate.toISOString();

  const result = await findAndClaimUnprocessed<Doc<'approvals'>>(ctx, {
    organizationId,
    tableName: 'approvals',
    wfDefinitionId,
    cutoffTimestamp,
    buildQuery: (resumeFrom) =>
      resumeFrom
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
            ),
  });

  return { approval: result.document };
}
