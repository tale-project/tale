/**
 * Customers API - Thin wrappers for customer operations
 *
 * This file contains all public and internal Convex functions for customers.
 * Business logic is in convex/model/customers/
 */

import { v } from 'convex/values';
import { internalQuery, internalMutation } from './_generated/server';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import { paginationOptsValidator } from 'convex/server';

// Import model functions and validators
import * as CustomersModel from './model/customers';
import {
  customerStatusValidator,
  customerSourceValidator,
  customerAddressValidator,
  customerValidator,
} from './model/customers/types';

// =============================================================================
// INTERNAL OPERATIONS (without RLS)
// =============================================================================

/**
 * Create a new customer (internal)
 */
export const createCustomer = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.optional(customerStatusValidator),
    source: v.optional(customerSourceValidator),
    locale: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    totalSpent: v.optional(v.number()),
    orderCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    externalId: v.optional(v.union(v.string(), v.number())),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    customerId: v.id('customers'),
  }),
  handler: async (ctx, args) => {
    return await CustomersModel.createCustomer(ctx, args);
  },
});

/**
 * Find or create a customer by email (internal)
 */
export const findOrCreateCustomer = internalMutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    source: v.optional(customerSourceValidator),
    status: v.optional(customerStatusValidator),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    customerId: v.id('customers'),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await CustomersModel.findOrCreateCustomer(ctx, args);
  },
});

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

/**
 * Query customers with flexible filtering and pagination (internal)
 */
export const queryCustomers = internalQuery({
  args: {
    organizationId: v.string(),
    externalId: v.optional(v.union(v.string(), v.number())),
    status: v.optional(customerStatusValidator),
    source: v.optional(customerSourceValidator),

    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await CustomersModel.queryCustomers(ctx, args);
  },
});

/**
 * Update customers with flexible filtering and updates (internal)
 */
export const updateCustomers = internalMutation({
  args: {
    customerId: v.optional(v.id('customers')),
    organizationId: v.optional(v.string()),
    status: v.optional(customerStatusValidator),

    updates: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      status: v.optional(customerStatusValidator),
      source: v.optional(v.string()),
      locale: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      totalSpent: v.optional(v.number()),
      orderCount: v.optional(v.number()),
      notes: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.any())),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('customers')),
  }),
  handler: async (ctx, args) => {
    return await CustomersModel.updateCustomers(ctx, args);
  },
});

/**
 * List customers by organization with pagination and field projection (internal operation)
 */
export const listByOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
    fields: v.optional(v.array(v.string())),
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await CustomersModel.listByOrganization(ctx, args);
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
    customers: v.array(v.any()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await CustomersModel.filterCustomers(ctx, args);
  },
});

// =============================================================================
// PUBLIC OPERATIONS (with RLS)
// =============================================================================

/**
 * Get a paginated list of customers for an organization
 */
export const getCustomers = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.array(customerStatusValidator)),
    source: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
    locale: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await CustomersModel.getCustomers(ctx, args);
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
 * Update an existing customer
 */
export const updateCustomer = mutationWithRLS({
  args: {
    customerId: v.id('customers'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    externalId: v.optional(v.string()),
    status: v.optional(customerStatusValidator),
    source: v.optional(customerSourceValidator),
    locale: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    firstPurchaseAt: v.optional(v.number()),
    lastPurchaseAt: v.optional(v.number()),
    churned_at: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    totalSpent: v.optional(v.number()),
    orderCount: v.optional(v.number()),
    metadata: v.optional(v.any()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await CustomersModel.updateCustomer(ctx, args);
  },
});

/**
 * Delete a customer
 */
export const deleteCustomer = mutationWithRLS({
  args: {
    customerId: v.id('customers'),
  },
  handler: async (ctx, args) => {
    return await CustomersModel.deleteCustomer(ctx, args.customerId);
  },
});

/**
 * Bulk create customers
 */
export const bulkCreateCustomers = mutationWithRLS({
  args: {
    organizationId: v.string(),
    customers: v.array(
      v.object({
        name: v.optional(v.string()),
        email: v.string(),
        phone: v.optional(v.string()),
        externalId: v.optional(v.string()),
        status: customerStatusValidator,
        source: customerSourceValidator,
        locale: v.optional(v.string()),
        address: v.optional(customerAddressValidator),
        firstPurchaseAt: v.optional(v.number()),
        lastPurchaseAt: v.optional(v.number()),
        churned_at: v.optional(v.number()),
        tags: v.optional(v.array(v.string())),
        totalSpent: v.optional(v.number()),
        orderCount: v.optional(v.number()),
        metadata: v.optional(v.any()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    return await CustomersModel.bulkCreateCustomers(
      ctx,
      args.organizationId,
      args.customers,
    );
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
