/**
 * Products Mutations
 *
 * All mutation operations for products.
 * Business logic is in convex/model/products/
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { mutationWithRLS } from '../lib/rls';
import * as ProductsModel from '../model/products';

// =============================================================================
// INTERNAL MUTATIONS (without RLS)
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

// =============================================================================
// PUBLIC MUTATIONS (with RLS)
// =============================================================================

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
