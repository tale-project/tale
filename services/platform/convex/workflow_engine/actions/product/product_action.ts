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
import type { QueryResult } from '../conversation/helpers/types';
import { productStatusValidator } from '../../../products/validators';
import {
	jsonRecordValidator,
	jsonValueValidator,
	type ConvexJsonRecord,
} from '../../../../lib/shared/schemas/utils/json-value';

type CreateProductResult = {
	success: boolean;
	productId: Id<'products'>;
};

const statusValidator = v.optional(productStatusValidator);

const paginationOptsValidator = v.object({
  numItems: v.number(),
  cursor: v.union(v.string(), v.null()),
});

const externalIdValidator = v.optional(
  v.union(v.string(), v.number(), v.array(v.union(v.string(), v.number()))),
);

// Type for product operation params (discriminated union)
type ProductActionParams =
  | {
      operation: 'create';
      name: string;
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
    }
  | {
      operation: 'get_by_id';
      productId: string;
    }
  | {
      operation: 'query';
      paginationOpts: { numItems: number; cursor: string | null };
      externalId?: string | number | (string | number)[];
      status?: 'active' | 'inactive' | 'draft' | 'archived';
      category?: string;
    }
  | {
      operation: 'update';
      productId: string;
      updates: Record<string, unknown>;
    }
  | {
      operation: 'filter';
      expression: string;
    }
  | {
      operation: 'hydrate_fields';
      items: unknown;
      idField?: string;
      mappings?: Record<string, string>;
      preserveExisting?: boolean;
    };

export const productAction: ActionDefinition<ProductActionParams> = {
  type: 'product',
  title: 'Product Operation',
  description:
    'Execute product-specific operations (create, get_by_id, query, update, filter, hydrate_fields). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // create: Create a new product
    v.object({
      operation: v.literal('create'),
      name: v.string(),
      description: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      stock: v.optional(v.number()),
      price: v.optional(v.number()),
      currency: v.optional(v.string()),
      category: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      status: statusValidator,
      externalId: externalIdValidator,
      metadata: v.optional(jsonRecordValidator),
    }),
    // get_by_id: Get a product by ID
    v.object({
      operation: v.literal('get_by_id'),
      productId: v.id('products'),
    }),
    // query: Query products with pagination
    v.object({
      operation: v.literal('query'),
      paginationOpts: paginationOptsValidator,
      externalId: externalIdValidator,
      status: statusValidator,
      category: v.optional(v.string()),
    }),
    // update: Update a product by ID
    v.object({
      operation: v.literal('update'),
      productId: v.id('products'),
      updates: v.record(v.string(), jsonValueValidator),
    }),
    // filter: Filter products using JEXL expressions
    v.object({
      operation: v.literal('filter'),
      expression: v.string(),
    }),
    // hydrate_fields: Hydrate product fields from database
    v.object({
      operation: v.literal('hydrate_fields'),
      items: jsonValueValidator,
      idField: v.optional(v.string()),
      mappings: v.optional(v.record(v.string(), v.string())),
      preserveExisting: v.optional(v.boolean()),
    }),
  ),
  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables
    const organizationId = variables.organizationId as string;

    switch (params.operation) {
      case 'create': {
        if (!organizationId) {
          throw new Error(
            'product create requires organizationId in workflow context',
          );
        }

        const result = (await ctx.runMutation!(
          internal.products.mutations.createProduct,
          {
            organizationId,
            name: params.name, // Required by validator
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
            metadata: params.metadata as ConvexJsonRecord | undefined,
          },
        )) as CreateProductResult;

        // Fetch and return the full created entity
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const createdProduct = await ctx.runQuery!(
          internal.products.queries.getProductById,
          { productId: result.productId },
        );

        return createdProduct;
      }

      case 'get_by_id': {
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const product = await ctx.runQuery!(internal.products.queries.getProductById, {
          productId: params.productId as Id<'products'>, // Required by validator
        });

        return product;
      }

      case 'query': {
        if (!organizationId) {
          throw new Error(
            'product query requires organizationId in workflow context',
          );
        }

        const result = (await ctx.runQuery!(internal.products.queries.queryProducts, {
          organizationId,
          externalId: params.externalId,
          status: params.status,
          category: params.category,
          paginationOpts: params.paginationOpts,
        })) as QueryResult;

        return {
          page: result.page,
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        };
      }

      case 'update': {
        await ctx.runMutation!(internal.products.mutations.updateProducts, {
          productId: params.productId as Id<'products'>, // Required by validator
          updates: params.updates, // Required by validator
        });

        // Fetch and return the updated entity
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const updatedProduct = await ctx.runQuery!(
          internal.products.queries.getProductById,
          { productId: params.productId as Id<'products'> },
        );

        return updatedProduct;
      }

      case 'filter': {
        // ⚠️ WARNING: This operation loops through ALL products in the organization.
        // Use with caution on large datasets. For simple queries, prefer the 'query' operation.
        if (!organizationId) {
          throw new Error(
            'product filter requires organizationId in workflow context',
          );
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const result = (await ctx.runQuery!(internal.products.queries.filterProducts, {
          organizationId,
          expression: params.expression, // Required by validator
        })) as { products: unknown[]; count: number };

        return result.products;
      }

      case 'hydrate_fields': {
        const input: any[] = Array.isArray(params.items)
          ? (params.items as any[])
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
            const doc = await ctx.runQuery!(internal.products.queries.getProductById, {
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

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return hydrated;
      }

      default:
        throw new Error(
          `Unsupported product operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
