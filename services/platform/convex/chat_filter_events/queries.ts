import { v } from 'convex/values';

import { DAY_MS, dailyKeys, utcDateKey } from '../../lib/shared/metrics-window';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
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

/** Cap on the stats scan — beyond it the figures report `capped: true`. */
const STATS_MAX_SCAN = 5000;
const STATS_TOP_CATEGORIES = 10;

const statsEntryValidator = v.object({
  key: v.string(),
  count: v.number(),
});

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toSortedEntries(
  counts: Map<string, number>,
): Array<{ key: string; count: number }> {
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregated guardrails activity for the chat health dashboard: event counts
 * by kind / filter / direction / category plus a per-day series. Same
 * admin-only gate and `by_org_createdAt` walk as `listRecent`, bounded to the
 * requested window.
 */
export const getGuardrailStats = query({
  args: {
    organizationId: v.string(),
    periodDays: v.union(v.literal(1), v.literal(7), v.literal(30)),
  },
  returns: v.object({
    byKind: v.array(statsEntryValidator),
    byFilter: v.array(statsEntryValidator),
    byDirection: v.array(statsEntryValidator),
    byCategory: v.array(statsEntryValidator),
    series: v.array(
      v.object({
        dateKey: v.string(),
        detected: v.number(),
        blocked: v.number(),
        errors: v.number(),
      }),
    ),
    capped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view guardrails events');
    }

    const now = Date.now();
    const windowStart = now - args.periodDays * DAY_MS;

    const kindCounts = new Map<string, number>();
    const filterCounts = new Map<string, number>();
    const directionCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    const seriesMap = new Map(
      dailyKeys(args.periodDays, now).map((dateKey) => [
        dateKey,
        { dateKey, detected: 0, blocked: 0, errors: 0 },
      ]),
    );

    let scanned = 0;
    let capped = false;
    for await (const event of ctx.db
      .query('chatFilterEvents')
      .withIndex('by_org_createdAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      // `createdAt` is an index key, so the newest-first walk is ordered by it
      // exactly — the first out-of-window row ends the scan.
      if (event.createdAt < windowStart) break;
      scanned++;
      if (scanned > STATS_MAX_SCAN) {
        capped = true;
        break;
      }

      increment(kindCounts, event.kind);
      increment(filterCounts, event.filterName);
      increment(directionCounts, event.direction);
      for (const categoryId of event.categoryIds) {
        increment(categoryCounts, categoryId);
      }

      const seriesPoint = seriesMap.get(utcDateKey(event.createdAt));
      if (seriesPoint) {
        if (event.kind === 'detected') seriesPoint.detected++;
        else if (event.kind === 'blocked') seriesPoint.blocked++;
        // The two failure kinds fold into one plotted "errors" band.
        else seriesPoint.errors++;
      }
    }

    return {
      byKind: toSortedEntries(kindCounts),
      byFilter: toSortedEntries(filterCounts),
      byDirection: toSortedEntries(directionCounts),
      byCategory: toSortedEntries(categoryCounts).slice(
        0,
        STATS_TOP_CATEGORIES,
      ),
      series: [...seriesMap.values()],
      capped,
    };
  },
});
