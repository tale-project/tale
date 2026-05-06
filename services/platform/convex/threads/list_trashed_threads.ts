/**
 * List trashed threads for the user-facing Trash UI.
 *
 * Two queries by audience:
 *   - `listMyTrashedThreads` — regular user view: only `status='trashed'`
 *     rows the user owns. Never returns `status='expired'` rows (those are
 *     retention-policy-removed and should not appear in user Trash to
 *     avoid confusion of "I didn't delete this, why is it here?").
 *   - `listOrgTrashedThreads` — admin-only view: both `'trashed'` and
 *     `'expired'`, with an `origin` discriminator so the UI can render
 *     "deleted by user" vs "removed by retention policy" badges and
 *     route 'expired' restores through a stricter confirmation dialog.
 *
 * Both queries use the existing `by_userId_chatType_status_updated` index
 * (and `by_organizationId` for the admin query); no new index needed.
 */

import type { PaginationOptions } from 'convex/server';

import type { QueryCtx } from '../_generated/server';

export interface TrashedThreadRow {
  _id: string; // threadId (not Convex _id) — matches Thread shape elsewhere
  _creationTime: number;
  title?: string;
  status: 'trashed' | 'expired';
  origin: 'user' | 'retention';
  userId: string;
  organizationId?: string;
  teamId?: string;
  /** ms since epoch when the row entered its current status. */
  statusChangedAt?: number;
}

interface ListResult {
  page: TrashedThreadRow[];
  isDone: boolean;
  continueCursor: string;
}

/** User-facing Trash: only rows the user trashed themselves. */
export async function listMyTrashedThreads(
  ctx: QueryCtx,
  args: {
    userId: string;
    paginationOpts: PaginationOptions;
    teamId?: string;
    organizationId?: string;
  },
): Promise<ListResult> {
  const result = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status_updated', (q) =>
      q
        .eq('userId', args.userId)
        .eq('chatType', 'general')
        .eq('status', 'trashed'),
    )
    .filter((q) => {
      if (args.teamId && args.organizationId) {
        return q.and(
          q.eq(q.field('teamId'), args.teamId),
          q.eq(q.field('organizationId'), args.organizationId),
        );
      }
      if (args.organizationId) {
        return q.eq(q.field('organizationId'), args.organizationId);
      }
      if (args.teamId) {
        return q.eq(q.field('teamId'), args.teamId);
      }
      return true;
    })
    .order('desc')
    .paginate(args.paginationOpts);

  return {
    page: result.page.map((row) => ({
      _id: row.threadId,
      _creationTime: row.updatedAt ?? row.createdAt,
      title: row.title,
      status: 'trashed' as const,
      origin: 'user' as const,
      userId: row.userId,
      organizationId: row.organizationId,
      teamId: row.teamId,
      statusChangedAt: row.statusChangedAt,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

/**
 * Admin-only Trash: both user-trashed and retention-expired across the
 * org. The caller must verify `isAdmin(member.role)` before invoking.
 *
 * Two passes over the (org, status, ...) index — `'trashed'` and
 * `'expired'` — merged in memory. For very large orgs, a Phase-7
 * compound `(orgId, status, _creationTime)` index would let us issue
 * a single range query; until then this is correct but pays one
 * round-trip per status.
 */
export async function listOrgTrashedThreads(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    paginationOpts: PaginationOptions;
  },
): Promise<ListResult> {
  // For the admin view we paginate via a single status at a time and let
  // the caller make a second call for the other state. A "merged" view
  // would require a different index shape (org first, then status); we
  // prefer the simpler pattern for now.
  const result = await ctx.db
    .query('threadMetadata')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .filter((q) =>
      q.or(
        q.eq(q.field('status'), 'trashed'),
        q.eq(q.field('status'), 'expired'),
      ),
    )
    .order('desc')
    .paginate(args.paginationOpts);

  return {
    page: result.page.map((row) => ({
      _id: row.threadId,
      _creationTime: row.updatedAt ?? row.createdAt,
      title: row.title,
      status: row.status === 'expired' ? 'expired' : 'trashed',
      origin: row.status === 'expired' ? 'retention' : 'user',
      userId: row.userId,
      organizationId: row.organizationId,
      teamId: row.teamId,
      statusChangedAt: row.statusChangedAt,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
