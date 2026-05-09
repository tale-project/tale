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
    /**
     * Caller's organizationId. When provided, the query refuses to
     * return a customer whose `organizationId` does not match —
     * closing the cross-org IDOR on REST `GET /api/v1/customers/:id`.
     * Optional for in-process callers (workflows, agent tools) that
     * already operate within a single org's trust boundary; REST
     * handlers MUST pass this. Returns `null` (not an error) on
     * mismatch so the REST layer surfaces 404 without leaking
     * customer existence across tenants.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await CustomersHelpers.getCustomerById(ctx, args.customerId);
    if (!row) return null;
    if (
      args.callerOrgId !== undefined &&
      row.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return row;
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
