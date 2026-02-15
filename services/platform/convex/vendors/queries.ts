import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { queryWithRLS } from '../lib/rls';
import { listVendorsPaginated as listVendorsPaginatedHelper } from './list_vendors_paginated';

export const listVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const results = [];
    for await (const vendor of ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(vendor);
    }
    return results;
  },
});

export const countVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await countItemsInOrg(ctx.db, 'vendors', args.organizationId);
  },
});

export const listVendorsPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    source: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listVendorsPaginatedHelper(ctx, args);
  },
});
