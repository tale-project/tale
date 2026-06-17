import { components } from '../../../_generated/api';
import type { QueryCtx, MutationCtx } from '../../../_generated/server';

interface MemberRow {
  organizationId: string;
  userId: string;
  role?: string;
}

/**
 * Check whether a user is a member of a given organization.
 * Returns true if a non-disabled membership row exists, false otherwise.
 *
 * Queries Better Auth's `member` table by `userId` (the `userId` index) and
 * resolves the org match in memory, rather than by `[organizationId, userId]`.
 * Both are indexed, but the by-`userId` shape is byte-identical to the one
 * `getUserOrganizations` issues for every `queryWithRLS` request — so the
 * cross-component result is shared with (and usually already warmed by) the
 * rest of the RLS layer's reactive cache. The previous per-call
 * `[organizationId, userId]` shape was unique to this helper: a cold,
 * unshared cross-component round-trip that, amplified ~5–10× by the local
 * self-hosted backend, could blow the 1s query budget — the
 * `getThreadBranchSelections` / `canAccessThread` timeout. A user belongs to a
 * handful of orgs, so the in-memory scan is trivial; paginate defensively for
 * the rare many-org account.
 */
export async function isOrgMember(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  // Fast path: the local `memberMirror` cache (kept in sync on every member
  // write path + an hourly reconcile). A hit avoids the cross-component Better
  // Auth round-trip that, amplified ~5–10× on the self-hosted backend, blows
  // the 1s function budget under CI starvation. A miss is NOT authoritative
  // (the mirror may be cold for this org), so fall through to Better Auth.
  const mirrored = await ctx.db
    .query('memberMirror')
    .withIndex('by_org_user', (q) =>
      q.eq('organizationId', organizationId).eq('userId', userId),
    )
    .first();
  if (mirrored) {
    return mirrored.role !== 'disabled';
  }

  let cursor: string | null = null;
  for (;;) {
    const result: {
      page: MemberRow[];
      isDone?: boolean;
      continueCursor?: string;
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor, numItems: 100 },
      where: [
        {
          field: 'userId',
          value: userId,
          operator: 'eq',
        },
      ],
    });
    if (!result || result.page.length === 0) break;
    const match = result.page.find((m) => m.organizationId === organizationId);
    if (match) return match.role !== 'disabled';
    // Stop on done, or if the cursor stops advancing (defensive against a
    // non-terminating adapter response) — mirrors getUserOrganizations.
    if (result.isDone || result.continueCursor === cursor) break;
    cursor = result.continueCursor ?? null;
  }
  return false;
}
