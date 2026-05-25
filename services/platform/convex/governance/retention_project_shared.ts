/**
 * Pure helper for the Projects feature's retention-cron interaction.
 *
 * When a thread owner trashes a thread that's `sharedWithProject=true`,
 * the row must NOT be silently hard-deleted out from under the other
 * project members while the project is still active. Treat the grace
 * timer as starting from the LATER of `statusChangedAt` and the
 * project's `archivedAt` — grace only counts down once the project
 * itself has been archived (or deleted).
 *
 * Extracted out of `internal_queries.ts:listGraceExpiredThreads` so the
 * decision is unit-testable without booting Convex.
 */

export interface ProjectSharedExpirySnapshot {
  threadSharedWithProject: boolean | undefined;
  /** Project's archivedAt timestamp, or null if the project is still active or missing. */
  projectArchivedAt: number | null | undefined;
  /** Project existence flag (false → project row no longer present; treat as inactive). */
  projectExists: boolean;
}

/**
 * Decide whether the project-shared-thread guard SHOULD defer the
 * grace-expire of this thread on the current cron pass.
 *
 * Returns `true` when expiry should be deferred (don't enqueue),
 * `false` when normal grace evaluation proceeds.
 */
export function shouldDeferProjectSharedExpiry(
  snapshot: ProjectSharedExpirySnapshot,
  graceCutoffMs: number,
): boolean {
  // Only applies to threads explicitly shared with their project.
  if (snapshot.threadSharedWithProject !== true) return false;

  // Project no longer exists → don't defer (no other members will see it).
  // The thread is effectively orphaned; let normal grace evaluation
  // proceed.
  if (!snapshot.projectExists) return false;

  const archivedAt = snapshot.projectArchivedAt;
  // Active project (no archivedAt) → defer until it's archived.
  if (archivedAt == null) return true;

  // Recently archived → defer until the project's own grace has elapsed.
  if (archivedAt >= graceCutoffMs) return true;

  // Project archived long enough ago → grace timer can proceed.
  return false;
}
