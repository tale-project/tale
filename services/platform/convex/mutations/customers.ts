/**
 * Customers Mutations
 *
 * All mutation operations for customers.
 * Business logic is in convex/models/customers/
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { mutationWithRLS } from '../lib/rls';
import * as CustomersModel from '../models/customers';
import {
  customerStatusValidator,
  customerSourceValidator,
  customerAddressValidator,
} from '../validators/customers';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

// =============================================================================
// INTERNAL MUTATIONS (without RLS)
// =============================================================================

/**
 * Create a new customer (internal)
 */
export const createCustomer = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    status: v.optional(customerStatusValidator),
    source: customerSourceValidator,
    locale: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    externalId: v.optional(v.union(v.string(), v.number())),
    metadata: v.optional(jsonRecordValidator),
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
    source: customerSourceValidator,
    status: v.optional(customerStatusValidator),
    metadata: v.optional(jsonRecordValidator),
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
      status: v.optional(customerStatusValidator),
      source: v.optional(v.string()),
      locale: v.optional(v.string()),
      address: v.optional(customerAddressValidator),
      metadata: v.optional(jsonRecordValidator),
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

// =============================================================================
// PUBLIC MUTATIONS (with RLS)
// =============================================================================

/**
 * Update an existing customer
 */
export const updateCustomer = mutationWithRLS({
  args: {
    customerId: v.id('customers'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    externalId: v.optional(v.string()),
    status: v.optional(customerStatusValidator),
    source: v.optional(customerSourceValidator),
    locale: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    metadata: v.optional(jsonRecordValidator),
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
        externalId: v.optional(v.string()),
        status: customerStatusValidator,
        source: customerSourceValidator,
        locale: v.optional(v.string()),
        address: v.optional(customerAddressValidator),
        metadata: v.optional(jsonRecordValidator),
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
