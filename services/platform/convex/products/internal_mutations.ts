import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { deleteProduct as deleteProductHandler } from './delete_product';
import * as ProductsHelpers from './helpers';
import type { CreateProductResult, UpdateProductsResult } from './types';
import { productStatusValidator } from './validators';

export const ingestProduct = internalMutation({
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
  handler: async (ctx, args): Promise<CreateProductResult> => {
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
    /**
     * Caller's organizationId — closes the cross-tenant write IDOR on
     * REST `PATCH /api/v1/products/:id`. Optional for in-process
     * callers; REST handlers MUST pass this. When set with a single
     * `productId`, the helper rejects writes whose target row is in
     * a different org.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('products')),
  }),
  handler: async (ctx, args): Promise<UpdateProductsResult> => {
    if (args.callerOrgId !== undefined && args.productId !== undefined) {
      const existing = await ctx.db.get(args.productId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        return { success: false, updatedCount: 0, updatedIds: [] };
      }
    }
    if (
      args.callerOrgId !== undefined &&
      args.organizationId !== undefined &&
      args.organizationId !== args.callerOrgId
    ) {
      return { success: false, updatedCount: 0, updatedIds: [] };
    }
    const { callerOrgId: _drop, ...rest } = args;
    return await ProductsHelpers.updateProducts(ctx, rest);
  },
});

export const deleteProduct = internalMutation({
  args: {
    productId: v.id('products'),
    /**
     * Caller's organizationId — closes the cross-tenant DELETE IDOR
     * on REST `DELETE /api/v1/products/:id`. Optional for in-process
     * callers; REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.id('products'),
  handler: async (ctx, args): Promise<Id<'products'>> => {
    if (args.callerOrgId !== undefined) {
      const existing = await ctx.db.get(args.productId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        throw new Error('Product not found');
      }
    }
    return await deleteProductHandler(ctx, args.productId);
  },
});
