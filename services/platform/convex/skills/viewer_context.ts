/**
 * Resolve the skill-viewer identity of a member: the team ids their team
 * skills are matched against plus whether they administer the org's shared
 * configuration.
 *
 * Deliberately takes `(organizationId, userId)` explicitly instead of
 * reading `ctx.auth`: the callers include scheduled turn actions (chat
 * staging, task hosts) that run on behalf of a stored thread owner with no
 * request identity. Membership is NOT verified here — every caller sits
 * behind a boundary that already did (a public action's
 * `requireOrgMembershipById`, a thread's stored owner, a task's run row).
 *
 * Reads the local RLS mirrors (`teamMemberMirror`, `memberMirror`) on the
 * hot path, with Better Auth as the error/miss fallback — the same posture
 * as `getOrganizationMember` and `getUserTeamIds`.
 */

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import { internalQuery, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';

export interface UserSkillViewerContext {
  readonly teamIds: string[];
  readonly isOrgAdmin: boolean;
}

async function findMemberRole(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  try {
    const row = await ctx.db
      .query('memberMirror')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', organizationId).eq('userId', userId),
      )
      .first();
    if (row) return row.role;
  } catch (err) {
    console.warn(
      '[skills] member mirror read failed; falling back to Better Auth',
      err instanceof Error ? err.message : err,
    );
  }
  const result: { page: Array<{ role?: string | null }> } = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', operator: 'eq', value: organizationId },
        { field: 'userId', operator: 'eq', value: userId },
      ],
    },
  );
  const member = result.page[0];
  return member?.role ?? null;
}

/**
 * The viewer context of one member, or `null` when they are not (or are no
 * longer) a member of the organization — a staging path treats that as "no
 * personal skills reachable", not as an error to surface.
 */
export async function getUserSkillViewerContextHandler(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
): Promise<UserSkillViewerContext | null> {
  const role = await findMemberRole(ctx, organizationId, userId);
  if (role === null) return null;
  const teamIds = await getUserTeamIds(ctx, userId);
  return {
    teamIds,
    isOrgAdmin: defineAbilityFor(role).can('write', 'orgSettings'),
  };
}

export const getUserSkillViewerContext = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      teamIds: v.array(v.string()),
      isOrgAdmin: v.boolean(),
    }),
  ),
  handler: async (ctx, args): Promise<UserSkillViewerContext | null> => {
    return getUserSkillViewerContextHandler(
      ctx,
      args.organizationId,
      args.userId,
    );
  },
});
