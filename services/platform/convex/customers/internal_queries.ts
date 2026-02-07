import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { getCustomerByEmail as getCustomerByEmailHelper } from './get_customer_by_email';
import * as CustomersHelpers from './helpers';
import {
  customerStatusValidator,
  customerSourceValidator,
  customerValidator,
} from './validators';

export const getCustomerByEmail = internalQuery({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await getCustomerByEmailHelper(ctx, args.organizationId, args.email);
  },
});

export const getCustomerById = internalQuery({
  args: {
    customerId: v.id('customers'),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersHelpers.getCustomerById(ctx, args.customerId);
  },
});

export const queryCustomers = internalQuery({
  args: {
    organizationId: v.string(),
    externalId: v.optional(v.union(v.string(), v.number())),
    status: v.optional(
      v.union(customerStatusValidator, v.array(customerStatusValidator)),
    ),
    source: v.optional(
      v.union(customerSourceValidator, v.array(customerSourceValidator)),
    ),
    locale: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(customerValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
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
