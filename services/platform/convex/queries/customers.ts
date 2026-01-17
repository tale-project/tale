/**
 * Customers Queries
 *
 * All query operations for customers.
 * Business logic is in convex/models/customers/
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { queryWithRLS } from '../lib/rls';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import * as CustomersModel from '../models/customers';
import {
  customerStatusValidator,
  customerSourceValidator,
  customerValidator,
} from '../validators/customers';

// =============================================================================
// INTERNAL QUERIES (without RLS)
// =============================================================================

/**
 * Get a customer by ID (internal)
 */
export const getCustomerById = internalQuery({
  args: {
    customerId: v.id('customers'),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersModel.getCustomerById(ctx, args.customerId);
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

/**
 * Query customers with flexible filtering and pagination (internal)
 */
export const queryCustomers = internalQuery({
  args: queryCustomersArgs,
  returns: queryCustomersReturns,
  handler: async (ctx, args) => {
    return await CustomersModel.queryCustomers(ctx, args);
  },
});

/**
 * Filter customers using JEXL expression (internal operation)
 */
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
    return await CustomersModel.filterCustomers(ctx, args);
  },
});

/**
 * Get a customer by email within an organization (internal)
 */
export const getCustomerByEmailInternal = internalQuery({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersModel.getCustomerByEmail(
      ctx,
      args.organizationId,
      args.email,
    );
  },
});

// =============================================================================
// PUBLIC QUERIES (with RLS)
// =============================================================================

/**
 * Check if organization has any customers (fast count query for empty state detection)
 */
export const hasCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const firstCustomer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return firstCustomer !== null;
  },
});

/**
 * Query customers with flexible filtering and pagination (public, with RLS)
 */
export const getCustomers = queryWithRLS({
  args: queryCustomersArgs,
  returns: queryCustomersReturns,
  handler: async (ctx, args) => {
    return await CustomersModel.queryCustomers(ctx, args);
  },
});

/**
 * Get a single customer by ID
 */
export const getCustomer = queryWithRLS({
  args: {
    customerId: v.id('customers'),
  },
  handler: async (ctx, args) => {
    return await CustomersModel.getCustomer(ctx, args.customerId);
  },
});

/**
 * Get a customer by email within an organization
 */
export const getCustomerByEmail = queryWithRLS({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await CustomersModel.getCustomerByEmail(
      ctx,
      args.organizationId,
      args.email,
    );
  },
});

/**
 * Get all customers for an organization without pagination or filtering.
 * Filtering, sorting, and pagination are performed client-side using TanStack DB Collections.
 */
export const getAllCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(customerValidator),
  handler: async (ctx, args) => {
    const customers = [];
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      customers.push(customer);
    }
    return customers;
  },
});
