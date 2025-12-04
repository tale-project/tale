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
 * - get_by_id: Get a customer by ID
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

// Type definitions for customer operations
type CreateCustomerResult = {
  success: boolean;
  customerId: Id<'customers'>;
};

type UpdateCustomersResult = {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'customers'>[];
};

type QueryResult<T = unknown> = {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
  count: number;
};

export const customerAction: ActionDefinition<{
  operation: 'create' | 'filter' | 'get_by_id' | 'query' | 'update';
  customerId?: string;
  organizationId?: string;
  name?: string;
  email?: string;
  externalId?: string | number;
  status?: 'active' | 'churned' | 'potential';
  source?: string;
  locale?: string;
  metadata?: Record<string, unknown>;

  updates?: Record<string, unknown>;
  paginationOpts?: {
    numItems: number;
    cursor: string | null;
  };
  expression?: string;
}> = {
  type: 'customer',
  title: 'Customer Operation',
  description:
    'Execute customer-specific operations (create, filter, get_by_id, query, update)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('create'),
      v.literal('filter'),
      v.literal('get_by_id'),
      v.literal('query'),
      v.literal('update'),
    ),
    customerId: v.optional(v.id('customers')),
    organizationId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    externalId: v.optional(v.union(v.string(), v.number())),
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('churned'),
        v.literal('potential'),
      ),
    ),
    source: v.optional(v.string()),
    locale: v.optional(v.string()),
    metadata: v.optional(v.any()),
    updates: v.optional(v.any()),
    paginationOpts: v.optional(
      v.object({
        numItems: v.number(),
        cursor: v.union(v.string(), v.null()),
      }),
    ),
    expression: v.optional(v.string()),
  }),
  async execute(ctx, params) {
    switch (params.operation) {
      case 'create': {
        if (!params.organizationId) {
          throw new Error('create operation requires organizationId parameter');
        }

        const result = (await ctx.runMutation!(
          internal.customers.createCustomer,
          {
            organizationId: params.organizationId,
            name: params.name,
            email: params.email,
            status: params.status,
            source: params.source as
              | 'manual_import'
              | 'file_upload'
              | 'circuly'
              | undefined,
            locale: params.locale,
            externalId: params.externalId,
            metadata: params.metadata,
          },
        )) as CreateCustomerResult;

        return {
          operation: 'create',
          customerId: result.customerId,
          success: result.success,
          timestamp: Date.now(),
        };
      }

      case 'filter': {
        // ⚠️ WARNING: This operation loops through ALL customers in the organization.
        // Use with caution on large datasets. For simple queries, prefer the 'query' operation.
        if (!params.organizationId) {
          throw new Error('filter operation requires organizationId parameter');
        }
        if (!params.expression) {
          throw new Error('filter operation requires expression parameter');
        }

        const result = (await ctx.runQuery!(
          internal.customers.filterCustomers,
          {
            organizationId: params.organizationId,
            expression: params.expression,
          },
        )) as { customers: unknown[]; count: number };

        return {
          operation: 'filter',
          customers: result.customers,
          count: result.count,
          timestamp: Date.now(),
        };
      }

      case 'get_by_id': {
        if (!params.customerId) {
          throw new Error('get_by_id operation requires customerId parameter');
        }

        const customer = await ctx.runQuery!(
          internal.customers.getCustomerById,
          {
            customerId: params.customerId as Id<'customers'>,
          },
        );

        return {
          operation: 'get_by_id',
          result: customer,
          found: customer !== null,
          timestamp: Date.now(),
        };
      }

      case 'query': {
        if (!params.organizationId) {
          throw new Error('query operation requires organizationId parameter');
        }

        if (!params.paginationOpts) {
          throw new Error('query operation requires paginationOpts parameter');
        }

        const result = (await ctx.runQuery!(internal.customers.queryCustomers, {
          organizationId: params.organizationId,
          externalId: params.externalId,
          status: params.status,
          source: params.source as
            | 'manual_import'
            | 'file_upload'
            | 'circuly'
            | undefined,
          paginationOpts: params.paginationOpts,
        })) as QueryResult;

        return {
          operation: 'query',
          page: result.page,
          isDone: result.isDone,
          continueCursor: result.continueCursor,
          count: result.count,
          timestamp: Date.now(),
        };
      }

      case 'update': {
        if (!params.customerId && !params.organizationId) {
          throw new Error(
            'update operation requires either customerId or organizationId parameter',
          );
        }
        if (!params.updates) {
          throw new Error('update operation requires updates parameter');
        }

        const result = (await ctx.runMutation!(
          internal.customers.updateCustomers,
          {
            customerId: params.customerId as Id<'customers'> | undefined,
            organizationId: params.organizationId,
            status: params.status,
            updates: params.updates,
          },
        )) as UpdateCustomersResult;

        return {
          operation: 'update',
          updatedCount: result.updatedCount,
          updatedIds: result.updatedIds,
          success: result.success,
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(
          `Unsupported customer operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
