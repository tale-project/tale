import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { bulkCreateCustomers as bulkCreateCustomersHelper } from './bulk_create_customers';
import { deleteCustomer as deleteCustomerHelper } from './delete_customer';
import * as CustomersHelpers from './helpers';
import { updateCustomer as updateCustomerHelper } from './update_customer';
import {
  customerAddressValidator,
  customerSourceValidator,
  customerStatusValidator,
  customerValidator,
} from './validators';

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

export const updateCustomer = internalMutation({
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
    /**
     * Caller's organizationId — closes the cross-tenant write IDOR on
     * REST `PATCH /api/v1/customers/:id`. Optional for in-process
     * callers; REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const existing = await ctx.db.get(args.customerId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        return null;
      }
    }
    const { callerOrgId: _drop, ...rest } = args;
    return await updateCustomerHelper(ctx, rest);
  },
});

export const deleteCustomer = internalMutation({
  args: {
    customerId: v.id('customers'),
    /**
     * Caller's organizationId — closes the cross-tenant DELETE IDOR
     * on REST `DELETE /api/v1/customers/:id`. Optional for in-process
     * callers (e.g. retention cleanup); REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const existing = await ctx.db.get(args.customerId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        return null;
      }
    }
    return await deleteCustomerHelper(ctx, args.customerId);
  },
});

export const bulkCreateCustomers = internalMutation({
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
        errorCode: v.string(),
        customer: v.any(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await bulkCreateCustomersHelper(
      ctx,
      args.organizationId,
      args.customers,
    );
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
      source: v.optional(customerSourceValidator),
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
