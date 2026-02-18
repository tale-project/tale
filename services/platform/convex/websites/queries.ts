import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { queryWithRLS } from '../lib/rls';
import { listWebsitesPaginated as listWebsitesPaginatedHelper } from './list_websites_paginated';
import { websiteValidator } from './validators';

export const listWebsites = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(websiteValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const website of ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(website);
    }
    return results;
  },
});

export const approxCountWebsites = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await countItemsInOrg(ctx.db, 'websites', args.organizationId);
  },
});

export const listWebsitesPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listWebsitesPaginatedHelper(ctx, args);
  },
});
