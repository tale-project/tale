import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
  computeFeedbackStats,
  type FeedbackStats,
  type FeedbackStatsAgentBucket,
  type FeedbackStatsModelBucket,
  ARENA_VERDICTS,
  type ArenaVerdict,
} from './stats';

const DAY_MS = 24 * 60 * 60 * 1000;

// Defensive cap when no period filter is supplied. With the
// by_org_createdAt index and a period bound, the iterator is naturally
// limited to the requested window — this only matters for "all-time".
const MAX_SCAN_ALL_TIME = 50_000;

const COMMENT_PROJECTION_MAX = 4_096;

const periodDaysValidator = v.optional(
  v.union(v.literal(1), v.literal(7), v.literal(30), v.literal(90)),
);

/**
 * Compute the inclusive lower-bound timestamp for a `periodDays` value.
 * Day-aligned UTC so totals reconcile with the Usage Analytics page,
 * which buckets by daily / weekly / monthly UTC keys.
 */
function periodCutoffMs(
  periodDays: 1 | 7 | 30 | 90 | undefined,
  now: number,
): number | null {
  if (periodDays === undefined) return null;
  const earliest = new Date(now - (periodDays - 1) * DAY_MS);
  const startOfDay = Date.UTC(
    earliest.getUTCFullYear(),
    earliest.getUTCMonth(),
    earliest.getUTCDate(),
  );
  return startOfDay;
}

export const getMessageFeedback = query({
  args: {
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

    const userId = String(authUser._id);

    return await ctx.db
      .query('messageFeedback')
      .withIndex('by_messageId_userId', (q) =>
        q.eq('messageId', args.messageId).eq('userId', userId),
      )
      .first();
  },
});

export interface FeedbackStatsResult extends FeedbackStats {
  hasAnyFeedback: boolean;
}

export const getFeedbackStats = query({
  args: {
    organizationId: v.string(),
    periodDays: periodDaysValidator,
    agentSlug: v.optional(v.string()),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<FeedbackStatsResult | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view feedback metrics');
    }

    const now = Date.now();
    const cutoffMs = periodCutoffMs(args.periodDays, now);

    // hasAnyFeedback is a single org-scoped existence probe, used by the UI
    // to distinguish "org has never collected feedback" from "no feedback
    // in the selected window." Cheap — the index lets Convex stop at the
    // first row.
    const probe = await ctx.db
      .query('messageFeedback')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    const hasAnyFeedback = probe !== null;

    const baseQuery = ctx.db
      .query('messageFeedback')
      .withIndex('by_org_createdAt', (q) => {
        const eq = q.eq('organizationId', args.organizationId);
        return cutoffMs !== null ? eq.gte('createdAt', cutoffMs) : eq;
      })
      .order('desc');

    const rows: Awaited<ReturnType<typeof baseQuery.collect>> = [];
    for await (const row of baseQuery) {
      rows.push(row);
      // The reducer applies its own MAX_SCAN cap; this loop is bounded by
      // the index range when cutoffMs is set. For all-time we still pull
      // a full slab into memory — tighten if it ever bites.
      if (cutoffMs === null && rows.length > MAX_SCAN_ALL_TIME) break;
    }

    const stats = computeFeedbackStats(rows, {
      cutoffMs,
      agentSlug: args.agentSlug,
      model: args.model,
      provider: args.provider,
      maxScan: cutoffMs === null ? MAX_SCAN_ALL_TIME : Number.POSITIVE_INFINITY,
    });

    return { ...stats, hasAnyFeedback };
  },
});

export interface RecentFeedbackItem {
  _id: string;
  threadId: string;
  messageId: string;
  userId: string;
  userDisplayName: string;
  rating: 'positive' | 'negative';
  comment: string | null;
  agentSlug: string | null;
  model: string | null;
  provider: string | null;
  arenaVerdict: ArenaVerdict | null;
  arenaModelA: string | null;
  arenaModelB: string | null;
  isArena: boolean;
  threadDeleted: boolean;
  createdAt: number;
}

export const listRecentFeedback = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    periodDays: periodDaysValidator,
    kind: v.optional(
      v.union(v.literal('all'), v.literal('message'), v.literal('arena')),
    ),
    withCommentOnly: v.optional(v.boolean()),
    agentSlug: v.optional(v.string()),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view feedback metrics');
    }

    const now = Date.now();
    const cutoffMs = periodCutoffMs(args.periodDays, now);

    const baseQuery = ctx.db
      .query('messageFeedback')
      .withIndex('by_org_createdAt', (q) => {
        const eq = q.eq('organizationId', args.organizationId);
        return cutoffMs !== null ? eq.gte('createdAt', cutoffMs) : eq;
      })
      .order('desc');

    const filteredQuery = baseQuery.filter((q) => {
      let predicate = q.eq(q.field('organizationId'), args.organizationId);
      if (args.agentSlug !== undefined) {
        predicate = q.and(
          predicate,
          q.eq(q.field('agentSlug'), args.agentSlug),
        );
      }
      if (args.model !== undefined) {
        predicate = q.and(predicate, q.eq(q.field('model'), args.model));
      }
      if (args.provider !== undefined) {
        predicate = q.and(predicate, q.eq(q.field('provider'), args.provider));
      }
      return predicate;
    });

    const result = await filteredQuery.paginate(args.paginationOpts);

    // Apply the kind / withCommentOnly post-filters in-memory. Convex's
    // filter() expression set doesn't currently support the "field is
    // defined / not defined" check we need for arenaVerdict cleanly, and
    // these filters narrow rows the index already shrunk by org+window.
    const wanted = result.page.filter((row) => {
      const isArena = row.metadata?.arenaVerdict !== undefined;
      if (args.kind === 'message' && isArena) return false;
      if (args.kind === 'arena' && !isArena) return false;
      if (args.withCommentOnly && !row.comment) return false;
      return true;
    });

    // Resolve user display names + thread-deleted state in a single pass
    // each. getUserNamesBatch already dedupes; threadMetadata lookup is by
    // primary key so cheap.
    const userIds = [...new Set(wanted.map((r) => r.userId))];
    const userNameMap = await getUserNamesBatch(ctx, userIds);

    const threadIds = [...new Set(wanted.map((r) => r.threadId))];
    const threadStatusMap = new Map<string, boolean>();
    for (const threadId of threadIds) {
      const meta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
        .first();
      threadStatusMap.set(
        threadId,
        !meta || meta.status === 'deleted' || meta.status === 'archived',
      );
    }

    const items: RecentFeedbackItem[] = wanted.map((row) => {
      const verdictRaw = row.metadata?.arenaVerdict;
      const arenaVerdict: ArenaVerdict | null =
        ARENA_VERDICTS.find((verdict) => verdict === verdictRaw) ?? null;
      return {
        _id: String(row._id),
        threadId: row.threadId,
        messageId: row.messageId,
        userId: row.userId,
        userDisplayName: userNameMap.get(row.userId) ?? row.userId,
        rating: row.rating,
        comment: row.comment
          ? row.comment.length > COMMENT_PROJECTION_MAX
            ? row.comment.slice(0, COMMENT_PROJECTION_MAX) + '…'
            : row.comment
          : null,
        agentSlug: row.agentSlug ?? null,
        model: row.model ?? null,
        provider: row.provider ?? null,
        arenaVerdict,
        arenaModelA: row.metadata?.modelA ?? null,
        arenaModelB: row.metadata?.modelB ?? null,
        isArena: row.metadata?.arenaVerdict !== undefined,
        threadDeleted: threadStatusMap.get(row.threadId) ?? false,
        createdAt: row.createdAt,
      };
    });

    return {
      ...result,
      page: items,
    };
  },
});

// Re-export bucket types so the page module imports them from one place.
export type { FeedbackStatsAgentBucket, FeedbackStatsModelBucket };
