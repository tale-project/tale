import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { queryWithRLS } from '../lib/rls';
import { listProductsPaginated as listProductsPaginatedHelper } from './list_products_paginated';
import { productDocValidator } from './validators';

export const listProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(productDocValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const product of ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(product);
    }
    return results;
  },
});

export const approxCountProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await countItemsInOrg(ctx.db, 'products', args.organizationId);
  },
});

export const listProductsPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listProductsPaginatedHelper(ctx, args);
  },
});
