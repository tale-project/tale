import { v } from 'convex/values';
import { mutationWithRLS } from '../lib/rls';
import * as ProductsHelpers from './helpers';
import {
  productStatusValidator,
  productTranslationValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const createProduct = mutationWithRLS({
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
    return await ProductsHelpers.createProductWithTranslations(ctx, args);
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
