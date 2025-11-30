/**
 * Product-specific workflow actions
 *
 * These actions provide safe, specialized operations for product data in workflows.
 * They replace generic database operations with purpose-built functions that:
 * - Use Convex indexes for efficient queries
 * - Require organizationId or productId to prevent accidental bulk operations
 * - Use lodash for safe nested metadata updates
 * - Support flexible filtering on status, category, externalId, and metadata fields
 * - Support JEXL expression-based filtering for advanced queries
 * - Follow Convex best practices
 *
 * Operations:
 * - create: Create a new product
 * - get_by_id: Get a product by ID
 * - query: Query products with pagination and filtering (uses indexes - RECOMMENDED)
 * - update: Update products with flexible filtering
 * - filter: Filter products using JEXL expressions (⚠️ loops through ALL products - use carefully)
 *
 * ⚠️ Filter operation warning:
 * The filter operation loops through ALL products in the organization.
 * Use with caution on large datasets. For simple queries, prefer the 'query' operation.
 *
 * Filter operation example:
 * {
 *   operation: 'filter',
 *   organizationId: 'org_123',
 *   expression: 'price > 100 && status == "active"'
 * }
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

// Type definitions for product operations
type CreateProductResult = {
  success: boolean;
  productId: Id<'products'>;
};

type UpdateProductsResult = {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'products'>[];
};

type QueryResult<T = unknown> = {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
  count: number;
};

export const productAction: ActionDefinition<{
  operation:
    | 'create'
    | 'get_by_id'
    | 'query'
    | 'update'
    | 'filter'
    | 'hydrate_fields';
  productId?: string;
  organizationId?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  tags?: string[];
  status?: 'active' | 'inactive' | 'draft' | 'archived';
  externalId?: string | number | (string | number)[];
  metadata?: Record<string, unknown>;

  updates?: Record<string, unknown>;
  paginationOpts?: {
    numItems: number;
    cursor: string | null;
  };
  expression?: string;

  // hydrate_fields
  items?: unknown;
  idField?: string;
  mappings?: Record<string, string>;
  preserveExisting?: boolean;
}> = {
  type: 'product',
  title: 'Product Operation',
  description:
    'Execute product-specific operations (create, get_by_id, query, update, filter, hydrate_fields)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('create'),
      v.literal('get_by_id'),
      v.literal('query'),
      v.literal('update'),
      v.literal('filter'),
      v.literal('hydrate_fields'),
    ),
    productId: v.optional(v.id('products')),
    organizationId: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    stock: v.optional(v.number()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('inactive'),
        v.literal('draft'),
        v.literal('archived'),
      ),
    ),
    externalId: v.optional(
      v.union(v.string(), v.number(), v.array(v.union(v.string(), v.number()))),
    ),
    metadata: v.optional(v.any()),
    updates: v.optional(v.any()),
    paginationOpts: v.optional(
      v.object({
        numItems: v.number(),
        cursor: v.union(v.string(), v.null()),
      }),
    ),
    expression: v.optional(v.string()),

    // hydrate_fields parameters
    items: v.optional(v.any()),
    idField: v.optional(v.string()),
    mappings: v.optional(v.record(v.string(), v.string())),
    preserveExisting: v.optional(v.boolean()),
  }),
  async execute(ctx, params) {
    switch (params.operation) {
      case 'create': {
        if (!params.organizationId) {
          throw new Error('create operation requires organizationId parameter');
        }
        if (!params.name) {
          throw new Error('create operation requires name parameter');
        }

        const result = (await ctx.runMutation!(
          internal.products.createProduct,
          {
            organizationId: params.organizationId,
            name: params.name,
            description: params.description,
            imageUrl: params.imageUrl,
            stock: params.stock,
            price: params.price,
            currency: params.currency,
            category: params.category,
            tags: params.tags,
            status: params.status,
            externalId: Array.isArray(params.externalId)
              ? params.externalId[0]
              : params.externalId,
            metadata: params.metadata,
          },
        )) as CreateProductResult;

        return {
          operation: 'create',
          productId: result.productId,
          success: result.success,
          timestamp: Date.now(),
        };
      }

      case 'get_by_id': {
        if (!params.productId) {
          throw new Error('get_by_id operation requires productId parameter');
        }

        const product = await ctx.runQuery!(internal.products.getProductById, {
          productId: params.productId as Id<'products'>,
        });

        return {
          operation: 'get_by_id',
          result: product,
          found: product !== null,
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

        const result = (await ctx.runQuery!(internal.products.queryProducts, {
          organizationId: params.organizationId,
          externalId: params.externalId,
          status: params.status,
          category: params.category,
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
        if (!params.productId && !params.organizationId) {
          throw new Error(
            'update operation requires either productId or organizationId parameter',
          );
        }
        if (!params.updates) {
          throw new Error('update operation requires updates parameter');
        }

        const result = (await ctx.runMutation!(
          internal.products.updateProducts,
          {
            productId: params.productId as Id<'products'> | undefined,
            organizationId: params.organizationId as string | undefined,
            externalId: params.externalId,
            status: params.status,
            category: params.category,
            updates: params.updates,
          },
        )) as UpdateProductsResult;

        return {
          operation: 'update',
          updatedCount: result.updatedCount,
          updatedIds: result.updatedIds,
          success: result.success,
          timestamp: Date.now(),
        };
      }

      case 'filter': {
        // ⚠️ WARNING: This operation loops through ALL products in the organization.
        // Use with caution on large datasets. For simple queries, prefer the 'query' operation.
        if (!params.organizationId) {
          throw new Error('filter operation requires organizationId parameter');
        }
        if (!params.expression) {
          throw new Error('filter operation requires expression parameter');
        }

        const result = (await ctx.runQuery!(internal.products.filterProducts, {
          organizationId: params.organizationId,
          expression: params.expression,
        })) as { products: unknown[]; count: number };

        return {
          operation: 'filter',
          products: result.products,
          count: result.count,
          timestamp: Date.now(),
        };
      }

      case 'hydrate_fields': {
        const input: any[] = Array.isArray(params.items)
          ? (params.items as any[])
          : Array.isArray((params as any).recommendations)
            ? ((params as any).recommendations as any[])
            : [];

        const idField: string = params.idField ?? 'product_id';
        const mappings: Record<string, string> = params.mappings ?? {};
        const preserveExisting: boolean = params.preserveExisting ?? true;

        const hydrated: any[] = [];
        for (const item of input) {
          try {
            const idVal = (item as any)?.[idField];
            if (typeof idVal !== 'string') {
              hydrated.push(item);
              continue;
            }
            const doc = await ctx.runQuery!(internal.products.getProductById, {
              productId: idVal as Id<'products'>,
            });
            const out: any = { ...item };
            for (const [targetKey, sourceKey] of Object.entries(mappings)) {
              const currentVal = out?.[targetKey];
              const sourceVal = (doc as any)?.[sourceKey];
              if (preserveExisting) {
                const isEmpty =
                  currentVal === undefined ||
                  currentVal === null ||
                  (typeof currentVal === 'string' && currentVal.length === 0);
                if (isEmpty) out[targetKey] = sourceVal ?? currentVal ?? '';
              } else {
                out[targetKey] = sourceVal;
              }
            }
            hydrated.push(out);
          } catch {
            hydrated.push(item);
          }
        }

        return {
          operation: 'hydrate_fields',
          items: hydrated,
          recommendations: hydrated,
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(
          `Unsupported product operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
