/**
 * Products Queries
 *
 * All query operations for products.
 * Business logic is in convex/models/products/
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { queryWithRLS } from '../lib/rls';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import * as ProductsModel from '../models/products';

// =============================================================================
// INTERNAL QUERIES (without RLS)
// =============================================================================

/**
 * Get a product by ID (internal operation)
 * Returns raw database document (not transformed API response)
 */
export const getProductById = internalQuery({
  args: {
    productId: v.id('products'),
  },
  returns: v.union(ProductsModel.productDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ProductsModel.getProductById(ctx, args.productId);
  },
});

/**
 * Query products with flexible filtering and pagination (internal operation)
 */
export const queryProducts = internalQuery({
  args: {
    organizationId: v.string(),
    externalId: v.optional(
      v.union(v.string(), v.number(), v.array(v.union(v.string(), v.number()))),
    ),
    status: v.optional(ProductsModel.productStatusValidator),
    category: v.optional(v.string()),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(ProductsModel.productDocValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.queryProducts(ctx, args);
  },
});

/**
 * List products by organization with pagination (internal operation)
 */
export const listByOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(ProductsModel.productDocValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.listByOrganization(ctx, args);
  },
});

/**
 * Filter products using JEXL expression (internal operation)
 */
export const filterProducts = internalQuery({
  args: {
    organizationId: v.string(),
    expression: v.string(),
  },
  returns: v.object({
    products: v.array(ProductsModel.productDocValidator),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.filterProducts(ctx, args);
  },
});

// =============================================================================
// PUBLIC QUERIES (with RLS)
// =============================================================================

/**
 * Check if organization has any products (fast count query for empty state detection)
 */
export const hasProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const firstProduct = await ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return firstProduct !== null;
  },
});

/**
 * Get a single product by ID
 */
export const getProduct = queryWithRLS({
  args: {
    productId: v.id('products'),
  },
  returns: ProductsModel.productItemValidator,
  handler: async (ctx, args) => {
    return await ProductsModel.getProduct(ctx, args.productId);
  },
});

/**
 * Get all products for an organization without pagination or filtering.
 * Filtering, sorting, and pagination are performed client-side using TanStack DB Collections.
 */
export const getAllProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(ProductsModel.productDocValidator),
  handler: async (ctx, args) => {
    const products = [];
    for await (const product of ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      products.push(product);
    }
    return products;
  },
});
