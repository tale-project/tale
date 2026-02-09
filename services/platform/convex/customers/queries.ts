import { v } from 'convex/values';

import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { queryWithRLS } from '../lib/rls';
import * as CustomersHelpers from './helpers';
import { customerValidator } from './validators';

export const hasCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await hasRecordsInOrg(ctx.db, 'customers', args.organizationId);
  },
});

export const getCustomer = queryWithRLS({
  args: {
    customerId: v.id('customers'),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersHelpers.getCustomer(ctx, args.customerId);
  },
});

export const getCustomerByEmail = queryWithRLS({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersHelpers.getCustomerByEmail(
      ctx,
      args.organizationId,
      args.email,
    );
  },
});

export const listCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(customerValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .paginate(args.paginationOpts);
  },
});
