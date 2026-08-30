/**
 * Get all organizations user has access to from Better Auth
 */

import type { MemberRole } from '../../../../lib/shared/schemas/organizations';
import type { QueryCtx } from '../../ctx';
import { components } from '../../handler_names';
import { getTrustedAuthData } from '../auth/get_trusted_auth_data';
import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import type { AuthenticatedUser, OrganizationMember } from '../types';

const VALID_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'disabled',
  'member',
  'editor',
  'developer',
  'admin',
]);

function isValidRole(role: string): role is MemberRole {
  return VALID_ROLES.has(role);
}

/**
 * Get all organizations user has access to from Better Auth's member table.
 *
 * In trusted headers mode, the role comes from the JWT claims (trustedRole)
 * instead of the member.role field in the database.
 */
export async function getUserOrganizations(
  ctx: QueryCtx,
  user?: AuthenticatedUser,
): Promise<
  Array<{
    organizationId: string;
    role: MemberRole;
    member: OrganizationMember;
  }>
> {
  const authUser = user || (await requireAuthenticatedUser(ctx));

  // Check if we're in trusted headers mode (role from JWT)
  const trustedData = await getTrustedAuthData(ctx);

  // Fast path: read the caller's memberships from the local `memberMirror`
  // cache (kept in sync on every member write path + an hourly reconcile),
  // avoiding the cross-component Better Auth round-trip that dominates RLS
  // latency and blows the 1s budget under CI starvation. The mirror is a
  // cache, never the authoritative gate: an EMPTY result is treated as a miss
  // and falls back to Better Auth (covers a cold mirror and brand-new users),
  // and the `trustedRole` override below is applied to mirror rows just the
  // same. A stale row (removal not yet synced) is bounded by the inline write
  // sync + after-middleware + the reconcile cron.
  const memberRows: OrganizationMember[] = [];
  for await (const row of ctx.db
    .query('memberMirror')
    .withIndex('by_userId', (q) => q.eq('userId', authUser.userId ?? ''))) {
    memberRows.push({
      _id: row.memberId,
      createdAt: row.createdAt,
      organizationId: row.organizationId,
      userId: row.userId,
      role: row.role,
    });
  }

  if (memberRows.length === 0) {
    // Mirror miss — fall back to Better Auth's member table, paginating until
    // the adapter reports done. The previous single 100-item page silently
    // dropped the tail for users in >100 orgs (and could strand the org
    // switcher); most users fit in one page, so the common case is still a
    // single round-trip.
    let cursor: string | null = null;
    for (;;) {
      // Explicit type breaks the otherwise-circular inference (result depends
      // on `cursor`, which is reassigned from `result.continueCursor`).
      const result: {
        page: OrganizationMember[];
        isDone?: boolean;
        continueCursor?: string;
      } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor, numItems: 100 },
        where: [
          {
            field: 'userId',
            value: authUser.userId ?? null,
            operator: 'eq',
          },
        ],
      });
      if (!result || result.page.length === 0) break;
      memberRows.push(...result.page);
      // Stop on done, or if the cursor stops advancing (defensive against a
      // non-terminating adapter response).
      if (result.isDone || result.continueCursor === cursor) break;
      cursor = result.continueCursor ?? null;
    }
  }

  if (memberRows.length === 0) {
    return [];
  }

  return memberRows
    .map((member) => {
      // Get role from trusted headers if available, otherwise from database
      const rawRole = trustedData?.trustedRole || member.role || 'member';
      const normalizedRole = rawRole.toLowerCase();
      const role: MemberRole = isValidRole(normalizedRole)
        ? normalizedRole
        : 'member';

      return {
        organizationId: member.organizationId,
        role,
        member,
      };
    })
    .filter(
      (entry: { organizationId: string; role: string; member: unknown }) =>
        entry.role !== 'disabled',
    );
}
