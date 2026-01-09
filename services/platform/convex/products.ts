/**
 * Products API - Thin wrappers around model functions
 */

import { v } from 'convex/values';
import { internalQuery, internalMutation } from './_generated/server';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import { cursorPaginationOptsValidator } from './lib/pagination';
import * as ProductsModel from './model/products';

// =============================================================================
// INTERNAL OPERATIONS
// =============================================================================

/**
 * Create a new product (internal operation)
 */
export const createProduct = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    stock: v.optional(v.number()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(ProductsModel.productStatusValidator),
    externalId: v.optional(v.union(v.string(), v.number())),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    productId: v.id('products'),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.createProduct(ctx, args);
  },
});

/**
 * Get a product by ID (internal operation)
 */
export const getProductById = internalQuery({
  args: {
    productId: v.id('products'),
  },
  returns: v.union(v.any(), v.null()),
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
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.queryProducts(ctx, args);
  },
});

/**
 * Update products with flexible filtering (internal operation)
 */
export const updateProducts = internalMutation({
  args: {
    productId: v.optional(v.id('products')),
    organizationId: v.optional(v.string()),
    externalId: v.optional(
      v.union(v.string(), v.number(), v.array(v.union(v.string(), v.number()))),
    ),
    status: v.optional(ProductsModel.productStatusValidator),
    category: v.optional(v.string()),

    updates: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      stock: v.optional(v.number()),
      price: v.optional(v.number()),
      currency: v.optional(v.string()),
      category: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      status: v.optional(ProductsModel.productStatusValidator),
      externalId: v.optional(v.union(v.string(), v.number())),
      metadata: v.optional(v.record(v.string(), v.any())),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('products')),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.updateProducts(ctx, args);
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
    page: v.array(v.any()),
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
    products: v.array(v.any()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.filterProducts(ctx, args);
  },
});

// =============================================================================
// PUBLIC API OPERATIONS (with RLS)
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
 * Get products with pagination, search, and filtering
 */
export const getProducts = queryWithRLS({
  args: {
    organizationId: v.string(),
    currentPage: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    searchQuery: v.optional(v.string()),
    category: v.optional(v.string()),
    status: v.optional(ProductsModel.productStatusValidator),
    sortBy: v.optional(ProductsModel.productSortByValidator),
    sortOrder: v.optional(ProductsModel.sortOrderValidator),
  },
  returns: ProductsModel.productListResponseValidator,
  handler: async (ctx, args) => {
    return await ProductsModel.getProducts(ctx, args);
  },
});

/**
 * Get products with cursor-based pagination (for infinite scroll)
 * Uses early termination to avoid reading all documents (prevents 16MB limit errors)
 */
export const getProductsCursor = queryWithRLS({
  args: {
    organizationId: v.string(),
    numItems: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
    searchQuery: v.optional(v.string()),
    category: v.optional(v.string()),
    status: v.optional(ProductsModel.productStatusValidator),
  },
  returns: v.object({
    page: v.array(ProductsModel.productItemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsModel.getProductsCursor(ctx, args);
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
 * Create a new product
 */
export const createProductPublic = mutationWithRLS({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    stock: v.optional(v.number()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(ProductsModel.productStatusValidator),
    translations: v.optional(
      v.array(ProductsModel.productTranslationValidator),
    ),
    metadata: v.optional(v.any()),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsModel.createProductPublic(ctx, args);
  },
});

/**
 * Update an existing product
 */
export const updateProduct = mutationWithRLS({
  args: {
    productId: v.id('products'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    stock: v.optional(v.number()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(ProductsModel.productStatusValidator),
    translations: v.optional(
      v.array(ProductsModel.productTranslationValidator),
    ),
    metadata: v.optional(v.any()),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsModel.updateProduct(ctx, args);
  },
});

/**
 * Delete a product
 */
export const deleteProduct = mutationWithRLS({
  args: {
    productId: v.id('products'),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsModel.deleteProduct(ctx, args.productId);
  },
});

/**
 * Upsert a product translation (create or update)
 */
export const upsertProductTranslation = mutationWithRLS({
  args: {
    productId: v.id('products'),
    language: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsModel.upsertProductTranslation(ctx, args);
  },
});
