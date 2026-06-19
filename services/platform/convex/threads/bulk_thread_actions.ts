import { ConvexError } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { loadActiveHolds } from '../governance/legal_hold';

// The action a "manage all my chats" sweep applies to each thread.
//   'delete'  → soft-delete (move to Trash) every active OR archived chat
//   'archive' → archive only the active chats (archived ones are no-ops)
export type BulkThreadAction = 'delete' | 'archive';

// Process the caller's chats a bounded number at a time. Each per-thread
// helper performs several cross-component calls (getThread / updateThread /
// cascade walks), so we keep the per-transaction fan-out small and let the
// scheduler chain batches until the collected id list is exhausted.
export const BULK_THREAD_BATCH_SIZE = 25;

/**
 * Collect the `threadId`s of the caller's own general chats that a bulk
 * action should touch:
 *   - `delete`  → every active OR archived thread (everything the user sees)
 *   - `archive` → only active threads (archived ones are already archived)
 *
 * Branches and non-`general` chat types are excluded — they aren't part of
 * the user-facing chat history. Scoped to `organizationId` when provided so a
 * user who belongs to multiple orgs only sweeps the current tenant's chats.
 */
export async function collectBulkActionThreadIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  organizationId: string | undefined,
  action: BulkThreadAction,
): Promise<string[]> {
  const rows = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status', (q) =>
      q.eq('userId', userId).eq('chatType', 'general'),
    )
    .collect();

  return rows
    .filter((row) => {
      if (row.isBranch === true) return false;
      // Discussions reuse chatType 'general' but live under Projects, not the
      // chat-history sidebar — never sweep them in a "manage all my chats"
      // bulk delete/archive (mirrors the exclusion in list_threads.ts).
      if (row.kind === 'project_discussion' || row.kind === 'task_discussion') {
        return false;
      }
      if (organizationId && row.organizationId !== organizationId) {
        return false;
      }
      if (action === 'archive') return row.status === 'active';
      return row.status === 'active' || row.status === 'archived';
    })
    .map((row) => row.threadId);
}

/**
 * Reject the whole bulk operation up front if the org or the caller is under
 * an active legal hold. The per-thread helpers already throw on hold, but
 * checking once here means the batch chain never starts processing rows it
 * can't complete (which would otherwise stall mid-sweep), and the UI gets a
 * single clear error instead of a partial result.
 */
export async function assertBulkActionAllowed(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  organizationId: string | undefined,
): Promise<void> {
  if (!organizationId) return;
  const holds = await loadActiveHolds(ctx, organizationId);
  const ownerHeld = holds.userMembershipIds.has(userId);
  if (holds.orgHeld || ownerHeld) {
    throw new ConvexError({
      code: 'LEGAL_HOLD_BLOCKS_BULK',
      message: holds.orgHeld
        ? 'Your organization is under an active legal hold — chats cannot be deleted or archived.'
        : 'You are on a custodian legal hold — chats cannot be deleted or archived.',
      orgHeld: holds.orgHeld,
      userCustodianHeld: ownerHeld,
    });
  }
}
