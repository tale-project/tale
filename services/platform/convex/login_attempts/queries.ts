import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

interface BlockCounterRow {
  _id: Id<'loginBlockCounters'>;
  email: string;
  windowStart: number;
  lockoutCount: number;
  ipLimitCount: number;
  lastIp?: string;
  updatedAt: number;
}

/**
 * Admin view of recent sign-in block activity. Returns hourly-bucketed
 * counters for any member of the caller's org, newest-first, limited to
 * the trailing 7 days.
 */
export const listBlockCounters = query({
  args: {
    organizationId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('loginBlockCounters'),
      email: v.string(),
      windowStart: v.number(),
      lockoutCount: v.number(),
      ipLimitCount: v.number(),
      lastIp: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view sign-in block activity');
    }

    // Filter counters by org membership: collect this org's member emails.
    const membersRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 500 },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
        ],
      },
    );
    const userIds: string[] = [];
    for (const row of membersRes?.page ?? []) {
      if (!isRecord(row)) continue;
      const userId = getString(row, 'userId');
      if (userId) userIds.push(userId);
    }

    const memberEmails = new Set<string>();
    if (userIds.length > 0) {
      const usersRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'user',
          paginationOpts: { cursor: null, numItems: 500 },
          where: [{ field: '_id', value: userIds, operator: 'in' }],
        },
      );
      for (const row of usersRes?.page ?? []) {
        if (!isRecord(row)) continue;
        const em = getString(row, 'email');
        if (em) memberEmails.add(em.toLowerCase());
      }
    }

    if (memberEmails.size === 0) return [];

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const limit = args.limit ?? 100;
    const out: BlockCounterRow[] = [];

    for await (const row of ctx.db
      .query('loginBlockCounters')
      .withIndex('by_window', (q) => q.gte('windowStart', sevenDaysAgo))
      .order('desc')) {
      if (!memberEmails.has(row.email)) continue;
      out.push({
        _id: row._id,
        email: row.email,
        windowStart: row.windowStart,
        lockoutCount: row.lockoutCount,
        ipLimitCount: row.ipLimitCount,
        lastIp: row.lastIp,
        updatedAt: row.updatedAt,
      });
      if (out.length >= limit) break;
    }
    return out;
  },
});
