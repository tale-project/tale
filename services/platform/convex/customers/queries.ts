import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { queryWithRLS } from '../lib/rls';
import { listCustomersPaginated as listCustomersPaginatedHelper } from './list_customers_paginated';
import { customerValidator } from './validators';

export const listCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(customerValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(customer);
    }
    return results;
  },
});

export const approxCountCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await countItemsInOrg(ctx.db, 'customers', args.organizationId);
  },
});

export const listCustomersPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(v.string()),
    source: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listCustomersPaginatedHelper(ctx, args);
  },
});
