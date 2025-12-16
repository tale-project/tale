/**
 * Customer-specific workflow actions
 *
 * These actions provide safe, specialized operations for customer data in workflows.
 * They replace generic database operations with purpose-built functions that:
 * - Use Convex indexes for efficient queries
 * - Require organizationId or customerId to prevent accidental bulk operations
 * - Use lodash for safe nested metadata updates
 * - Support flexible filtering on status and metadata fields
 * - Support JEXL expression-based filtering for advanced queries
 * - Follow Convex best practices
 *
 * Operations:
 * - create: Create a new customer
 * - filter: Filter customers using JEXL expressions (⚠️ loops through ALL customers - use carefully)
 * - query: Query customers with pagination and filtering (uses indexes - RECOMMENDED)
 * - update: Update customers with flexible filtering
 *
 * ⚠️ Filter operation warning:
 * The filter operation loops through ALL customers in the organization.
 * Use with caution on large datasets. For simple queries, prefer the 'query' operation.
 *
 * Filter operation example:
 * {
 *   operation: 'filter',
 *   organizationId: 'org_123',
 *   expression: 'totalSpent > 1000 && status == "active"'
 * }
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import type { QueryResult } from '../conversation/helpers/types';
import {
  customerStatusValidator,
  customerAddressValidator,
} from '../../../model/customers/types';

// Type definitions for customer operations
type CreateCustomerResult = {
  success: boolean;
  customerId: Id<'customers'>;
};

// Common field validators
const statusValidator = v.optional(customerStatusValidator);

// Customer update validator - must match internal.customers.updateCustomers
const customerUpdateValidator = v.object({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  status: v.optional(customerStatusValidator),
  source: v.optional(v.string()),
  locale: v.optional(v.string()),
  address: v.optional(customerAddressValidator),
  metadata: v.optional(v.record(v.string(), v.any())),
});

const paginationOptsValidator = v.object({
  numItems: v.number(),
  cursor: v.union(v.string(), v.null()),
});

// Type for customer address
type CustomerAddress = {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
};

// Type for all customer operation params (discriminated union)
type CustomerActionParams =
  | {
      operation: 'create';
      name?: string;
      email?: string;
      externalId?: string | number;
      status?: 'active' | 'churned' | 'potential';
      source?: string;
      locale?: string;
      address?: CustomerAddress;
      metadata?: Record<string, unknown>;
    }
  | {
      operation: 'filter';
      expression: string;
    }
  | {
      operation: 'query';
      paginationOpts: { numItems: number; cursor: string | null };
      externalId?: string | number;
      status?: 'active' | 'churned' | 'potential';
      source?: string;
    }
  | {
      operation: 'update';
      customerId: string;
      updates: Record<string, unknown>;
    };

export const customerAction: ActionDefinition<CustomerActionParams> = {
  type: 'customer',
  title: 'Customer Operation',
  description:
    'Execute customer-specific operations (create, filter, query, update). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // create: Create a new customer
    v.object({
      operation: v.literal('create'),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      externalId: v.optional(v.union(v.string(), v.number())),
      status: statusValidator,
      source: v.optional(v.string()),
      locale: v.optional(v.string()),
      address: v.optional(customerAddressValidator),
      metadata: v.optional(v.record(v.string(), v.any())),
    }),
    // filter: Filter customers using JEXL expressions
    v.object({
      operation: v.literal('filter'),
      expression: v.string(),
    }),
    // query: Query customers with pagination
    v.object({
      operation: v.literal('query'),
      paginationOpts: paginationOptsValidator,
      externalId: v.optional(v.union(v.string(), v.number())),
      status: statusValidator,
      source: v.optional(v.string()),
    }),
    // update: Update a customer by ID
    v.object({
      operation: v.literal('update'),
      customerId: v.id('customers'),
      updates: customerUpdateValidator,
    }),
  ),
  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'customer action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create': {

        const result = (await ctx.runMutation!(
          internal.customers.createCustomer,
          {
            organizationId,
            name: params.name,
            email: params.email,
            status: params.status,
            source: params.source as
              | 'manual_import'
              | 'file_upload'
              | 'circuly'
              | undefined,
            locale: params.locale,
            address: params.address,
            externalId: params.externalId,
            metadata: params.metadata,
          },
        )) as CreateCustomerResult;

        // Fetch and return the full created entity
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const createdCustomer = await ctx.runQuery!(
          internal.customers.getCustomerById,
          { customerId: result.customerId },
        );

        if (!createdCustomer) {
          throw new Error(
            `Failed to fetch created customer with ID "${result.customerId}"`,
          );
        }

        return createdCustomer;
      }

      case 'filter': {
        // ⚠️ WARNING: This operation loops through ALL customers in the organization.
        // Use with caution on large datasets. For simple queries, prefer the 'query' operation.
        // Note: organizationId is already validated at the start of execute()

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const result = (await ctx.runQuery!(
          internal.customers.filterCustomers,
          {
            organizationId,
            expression: params.expression, // Required by validator
          },
        )) as { customers: unknown[]; count: number };

        return result.customers;
      }

      case 'query': {
        // Note: organizationId is already validated at the start of execute()

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        // For pagination queries, we return the full result object (items, isDone, continueCursor)
        const result = (await ctx.runQuery!(internal.customers.queryCustomers, {
          organizationId,
          externalId: params.externalId,
          status: params.status,
          source: params.source as
            | 'manual_import'
            | 'file_upload'
            | 'circuly'
            | undefined,
          paginationOpts: params.paginationOpts, // Required by validator
        })) as QueryResult;

        return {
          items: result.items,
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        };
      }

      case 'update': {
        // Extract customerId to avoid duplicate type assertion
        const customerId = params.customerId as Id<'customers'>;

        await ctx.runMutation!(internal.customers.updateCustomers, {
          customerId, // Required by validator
          updates: params.updates, // Required by validator
        });

        // Fetch and return the updated entity
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const updatedCustomer = await ctx.runQuery!(
          internal.customers.getCustomerById,
          { customerId },
        );

        if (!updatedCustomer) {
          throw new Error(
            `Failed to fetch updated customer with ID "${customerId}"`,
          );
        }

        return updatedCustomer;
      }

      default:
        throw new Error(
          `Unsupported customer operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
