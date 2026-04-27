import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

/**
 * Recent guardrails events for the Guardrails Overview dashboard.
 *
 * Admin-only. Walks `by_org_createdAt` newest-first up to `limit` rows.
 * Raw matched text is NOT stored (invariant maintained by the write path
 * in `chat_filter_events/internal_mutations.ts` and `governance/sanitize.ts`)
 * so there is nothing PII-sensitive here beyond `threadId` / `messageId`
 * which the admin already has access to through chat history.
 */
export const listRecent = query({
  args: {
    organizationId: v.string(),
    limit: v.optional(v.number()),
    filterName: v.optional(
      v.union(
        v.literal('pii'),
        v.literal('chat_filter'),
        v.literal('moderation_provider'),
      ),
    ),
    kind: v.optional(
      v.union(
        v.literal('detected'),
        v.literal('blocked'),
        v.literal('step_error'),
        v.literal('circuit_open'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view guardrails events');
    }

    const limit = Math.min(args.limit ?? 50, 200);

    // Pick the best available index for the requested filter combination.
    // When the admin filters by `kind`, `by_org_kind_createdAt` lets us skip
    // non-matching rows at index level; same for `filterName` with
    // `by_org_filter_createdAt`. Without either filter we fall back to the
    // plain `by_org_createdAt` scan.
    let results;
    if (args.kind !== undefined) {
      const kindValue = args.kind;
      results = await ctx.db
        .query('chatFilterEvents')
        .withIndex('by_org_kind_createdAt', (q) =>
          q.eq('organizationId', args.organizationId).eq('kind', kindValue),
        )
        .order('desc')
        .take(limit * 2);
      if (args.filterName !== undefined) {
        results = results.filter((e) => e.filterName === args.filterName);
      }
    } else if (args.filterName !== undefined) {
      const filterName = args.filterName;
      results = await ctx.db
        .query('chatFilterEvents')
        .withIndex('by_org_filter_createdAt', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('filterName', filterName),
        )
        .order('desc')
        .take(limit);
    } else {
      results = await ctx.db
        .query('chatFilterEvents')
        .withIndex('by_org_createdAt', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .order('desc')
        .take(limit);
    }

    return results.slice(0, limit);
  },
});
