import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { mutationWithRLS } from '../lib/rls';
import * as CustomersHelpers from './helpers';
import {
  customerAddressValidator,
  customerSourceValidator,
  customerStatusValidator,
  customerValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

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
    return await CustomersHelpers.createCustomer(ctx, args);
  },
});

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
    return await CustomersHelpers.findOrCreateCustomer(ctx, args);
  },
});

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
    return await CustomersHelpers.updateCustomers(ctx, args);
  },
});

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
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    return await CustomersHelpers.updateCustomer(ctx, args);
  },
});

export const deleteCustomer = mutationWithRLS({
  args: {
    customerId: v.id('customers'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await CustomersHelpers.deleteCustomer(ctx, args.customerId);
  },
});

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
  returns: v.object({
    success: v.number(),
    failed: v.number(),
    errors: v.array(
      v.object({
        index: v.number(),
        error: v.string(),
        customer: v.any(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await CustomersHelpers.bulkCreateCustomers(
      ctx,
      args.organizationId,
      args.customers,
    );
  },
});
