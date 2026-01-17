import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { mutationWithRLS } from '../lib/rls';
import * as ProductsHelpers from './helpers';
import {
  productStatusValidator,
  productTranslationValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

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
    status: v.optional(productStatusValidator),
    externalId: v.optional(v.union(v.string(), v.number())),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.object({
    success: v.boolean(),
    productId: v.id('products'),
  }),
  handler: async (ctx, args) => {
    return await ProductsHelpers.createProduct(ctx, args);
  },
});

export const updateProducts = internalMutation({
  args: {
    productId: v.optional(v.id('products')),
    organizationId: v.optional(v.string()),
    externalId: v.optional(
      v.union(v.string(), v.number(), v.array(v.union(v.string(), v.number()))),
    ),
    status: v.optional(productStatusValidator),
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
      status: v.optional(productStatusValidator),
      externalId: v.optional(v.union(v.string(), v.number())),
      metadata: v.optional(jsonRecordValidator),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('products')),
  }),
  handler: async (ctx, args) => {
    return await ProductsHelpers.updateProducts(ctx, args);
  },
});

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
    status: v.optional(productStatusValidator),
    translations: v.optional(
      v.array(productTranslationValidator),
    ),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsHelpers.createProductPublic(ctx, args);
  },
});

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
    status: v.optional(productStatusValidator),
    translations: v.optional(
      v.array(productTranslationValidator),
    ),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsHelpers.updateProduct(ctx, args);
  },
});

export const deleteProduct = mutationWithRLS({
  args: {
    productId: v.id('products'),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsHelpers.deleteProduct(ctx, args.productId);
  },
});

export const upsertProductTranslation = mutationWithRLS({
  args: {
    productId: v.id('products'),
    language: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    return await ProductsHelpers.upsertProductTranslation(ctx, args);
  },
});
