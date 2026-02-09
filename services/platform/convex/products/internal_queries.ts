import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import * as ProductsHelpers from './helpers';
import { productStatusValidator, productDocValidator } from './validators';

export const getProductById = internalQuery({
  args: {
    productId: v.id('products'),
  },
  returns: v.union(productDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ProductsHelpers.getProductById(ctx, args.productId);
  },
});

export const queryProducts = internalQuery({
  args: {
    organizationId: v.string(),
    externalId: v.optional(
      v.union(v.string(), v.number(), v.array(v.union(v.string(), v.number()))),
    ),
    status: v.optional(productStatusValidator),
    category: v.optional(v.string()),
    minStock: v.optional(v.number()),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(productDocValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsHelpers.queryProducts(ctx, args);
  },
});

export const listByOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(productDocValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ProductsHelpers.listByOrganization(ctx, args);
  },
});

export const filterProducts = internalQuery({
  args: {
    organizationId: v.string(),
    expression: v.string(),
  },
  returns: v.object({
    products: v.array(productDocValidator),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ProductsHelpers.filterProducts(ctx, args);
  },
});
