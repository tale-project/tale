import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import type { CursorPaginatedResult } from '../lib/pagination';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import * as ProductsHelpers from './helpers';
import { productStatusValidator, productDocValidator } from './validators';

export const getProductById = internalQuery({
  args: {
    productId: v.id('products'),
    /**
     * Caller's organizationId — closes the cross-tenant read IDOR on
     * REST `GET /api/v1/products/:id`. Optional for in-process callers;
     * REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.union(productDocValidator, v.null()),
  handler: async (ctx, args): Promise<Doc<'products'> | null> => {
    const row = await ProductsHelpers.getProductById(ctx, args.productId);
    if (!row) return null;
    if (
      args.callerOrgId !== undefined &&
      row.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return row;
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
  handler: async (
    ctx,
    args,
  ): Promise<CursorPaginatedResult<Doc<'products'>>> => {
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
  handler: async (
    ctx,
    args,
  ): Promise<CursorPaginatedResult<Doc<'products'>>> => {
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
  handler: async (
    ctx,
    args,
  ): Promise<{ products: Doc<'products'>[]; count: number }> => {
    return await ProductsHelpers.filterProducts(ctx, args);
  },
});
