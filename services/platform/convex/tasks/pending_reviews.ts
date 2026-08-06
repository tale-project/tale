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

/** One project task's pending review, as the board indicators consume it. */
export interface PendingTaskReviewRef {
  approvalId: Id<'approvals'>;
  /** The named reviewer the request waits on (`metadata.requestedFor`);
   * undefined when the review was minted with no resolvable reviewer. */
  requestedFor?: string;
}

/** taskId (string form) → the pending approval, for one project. */
export async function collectPendingReviewsByTask(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: string,
  projectId: Id<'projects'>,
): Promise<Map<string, PendingTaskReviewRef>> {
  const byTask = new Map<string, PendingTaskReviewRef>();
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
    const requestedFor =
      typeof metadata.requestedFor === 'string' && metadata.requestedFor !== ''
        ? metadata.requestedFor
        : undefined;
    // task_review approvals store String(taskId) as resourceId.
    byTask.set(approval.resourceId, {
      approvalId: approval._id,
      ...(requestedFor !== undefined ? { requestedFor } : {}),
    });
    if (byTask.size >= PENDING_REVIEW_SCAN_CAP) break;
  }
  return byTask;
}
