import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { queryWithRLS } from '../lib/rls';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';
import * as CustomersHelpers from './helpers';
import {
  customerStatusValidator,
  customerSourceValidator,
  customerValidator,
} from './validators';

export const getCustomerById = internalQuery({
  args: {
    customerId: v.id('customers'),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersHelpers.getCustomerById(ctx, args.customerId);
  },
});

const queryCustomersArgs = {
  organizationId: v.string(),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(
    v.union(customerStatusValidator, v.array(customerStatusValidator)),
  ),
  source: v.optional(v.union(customerSourceValidator, v.array(v.string()))),
  locale: v.optional(v.array(v.string())),
  searchTerm: v.optional(v.string()),
  paginationOpts: cursorPaginationOptsValidator,
};

const queryCustomersReturns = v.object({
  page: v.array(customerValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const queryCustomers = internalQuery({
  args: queryCustomersArgs,
  returns: queryCustomersReturns,
  handler: async (ctx, args) => {
    return await CustomersHelpers.queryCustomers(ctx, args);
  },
});

export const filterCustomers = internalQuery({
  args: {
    organizationId: v.string(),
    expression: v.string(),
  },
  returns: v.object({
    customers: v.array(customerValidator),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await CustomersHelpers.filterCustomers(ctx, args);
  },
});

export const getCustomerByEmailInternal = internalQuery({
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
  handler: async (ctx, args) => {
    return await CustomersHelpers.getCustomer(ctx, args.customerId);
  },
});

export const getCustomerByEmail = queryWithRLS({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
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
