/**
 * Query products with flexible filtering and pagination support (internal operation)
 *
 * Uses smart index selection based on available filters:
 * - externalId (single): by_organizationId_and_externalId
 * - status: by_organizationId_and_status
 * - category: by_organizationId_and_category
 * - default: by_organizationId
 */

import { QueryCtx } from '../_generated/server';
import { Doc } from '../_generated/dataModel';
import { paginateWithFilter, type CursorPaginatedResult } from '../lib/pagination';
import { ProductStatus } from './types';

export interface QueryProductsArgs {
  organizationId: string;
  externalId?: string | number | Array<string | number>;
  status?: ProductStatus;
  category?: string;
  minStock?: number;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

function buildQuery(ctx: QueryCtx, args: QueryProductsArgs) {
  const { organizationId } = args;

  if (args.externalId !== undefined && !Array.isArray(args.externalId)) {
    return {
      query: ctx.db
        .query('products')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('externalId', args.externalId as string | number),
        ),
      indexedFields: { externalId: true } as const,
    };
  }

  if (args.status !== undefined) {
    return {
      query: ctx.db
        .query('products')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', args.status!),
        ),
      indexedFields: { status: true } as const,
    };
  }

  if (args.category !== undefined) {
    return {
      query: ctx.db
        .query('products')
        .withIndex('by_organizationId_and_category', (q) =>
          q.eq('organizationId', organizationId).eq('category', args.category!),
        ),
      indexedFields: { category: true } as const,
    };
  }

  return {
    query: ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      ),
    indexedFields: {} as const,
  };
}

export async function queryProducts(
  ctx: QueryCtx,
  args: QueryProductsArgs,
): Promise<CursorPaginatedResult<Doc<'products'>>> {
  const { numItems, cursor } = args.paginationOpts;

  // Special case: externalId array - use parallel targeted queries
  if (args.externalId !== undefined && Array.isArray(args.externalId)) {
    const externalIdArray = args.externalId as Array<string | number>;
    const productPromises = externalIdArray.map((externalId) =>
      ctx.db
        .query('products')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('externalId', externalId),
        )
        .first(),
    );

    const productResults = await Promise.all(productPromises);

    // Filter out nulls and dedupe
    const seenIds = new Set<string>();
    let products = productResults.filter((p): p is Doc<'products'> => {
      if (p === null || seenIds.has(p._id)) return false;
      seenIds.add(p._id);
      return true;
    });

    // Apply additional filters
    if (args.status !== undefined) {
      products = products.filter((p) => p.status === args.status);
    }
    if (args.category !== undefined) {
      products = products.filter((p) => p.category === args.category);
    }
    if (args.minStock !== undefined) {
      products = products.filter(
        (p) => p.stock !== undefined && p.stock !== null && p.stock >= args.minStock!,
      );
    }

    // Sort by creation time (newest first)
    products.sort((a, b) => b._creationTime - a._creationTime);

    // Apply cursor-based pagination
    const startIndex = cursor ? products.findIndex((p) => p._id === cursor) + 1 : 0;
    const paginatedProducts = products.slice(startIndex, startIndex + numItems);
    const hasMore = startIndex + numItems < products.length;

    return {
      page: paginatedProducts,
      isDone: !hasMore,
      continueCursor:
        paginatedProducts.length > 0
          ? paginatedProducts[paginatedProducts.length - 1]._id
          : '',
    };
  }

  const { query, indexedFields } = buildQuery(ctx, args);

  const needsStatusFilter = !('status' in indexedFields) && args.status !== undefined;
  const needsCategoryFilter = !('category' in indexedFields) && args.category !== undefined;
  const needsMinStockFilter = args.minStock !== undefined;
  const needsFilter = needsStatusFilter || needsCategoryFilter || needsMinStockFilter;

  const filter = needsFilter
    ? (product: Doc<'products'>): boolean => {
        if (needsStatusFilter && product.status !== args.status) return false;
        if (needsCategoryFilter && product.category !== args.category) return false;
        if (needsMinStockFilter) {
          if (product.stock === undefined || product.stock === null || product.stock < args.minStock!) {
            return false;
          }
        }
        return true;
      }
    : undefined;

  return paginateWithFilter(query.order('desc'), {
    numItems,
    cursor,
    filter,
  });
}
