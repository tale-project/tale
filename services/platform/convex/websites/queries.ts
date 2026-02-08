import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';

export const hasWebsites = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return false;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return false;
    }

    return await hasRecordsInOrg(ctx.db, 'websites', args.organizationId);
  },
});

/**
 * List websites with cursor pagination.
 */
export const listWebsites = query({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const emptyResult = { page: [] as Doc<'websites'>[], isDone: true as const, continueCursor: '' };

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return emptyResult;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return emptyResult;
    }

    return await ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .paginate(args.paginationOpts);
  },
});
