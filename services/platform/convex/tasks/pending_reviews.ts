/**
 * Shared pending review-gate lookup: which of a project's tasks currently hold
 * a PENDING `task_review` approval. One bounded, index-backed org-level scan
 * (pending reviews are rare org-wide, so the project filter stays tiny) — the
 * same read `getTaskOpsIndicators` popularized, extracted so the paginated
 * task list can stamp a per-row `pendingReview` flag for view actions
 * (`when: "pendingReview"`) without a second divergent scan.
 */

import { isRecord } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** Bounded scan cap — mirrors the board's TASK_OPS_INDICATOR_CAP. */
export const PENDING_REVIEW_SCAN_CAP = 50;

/** taskId (string form) → the pending approval's id, for one project. */
export async function collectPendingReviewsByTask(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: string,
  projectId: Id<'projects'>,
): Promise<Map<string, Id<'approvals'>>> {
  const byTask = new Map<string, Id<'approvals'>>();
  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_org_status_resourceType', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('status', 'pending')
        .eq('resourceType', 'task_review'),
    )) {
    const metadata: unknown = approval.metadata;
    if (!isRecord(metadata)) continue;
    if (metadata.projectId !== String(projectId)) continue;
    // task_review approvals store String(taskId) as resourceId.
    byTask.set(approval.resourceId, approval._id);
    if (byTask.size >= PENDING_REVIEW_SCAN_CAP) break;
  }
  return byTask;
}
