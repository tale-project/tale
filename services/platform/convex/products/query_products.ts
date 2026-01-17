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
  paginationOpts: {
    numItems: number;
    cursor: string | null;
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

  // Select the best index based on available filters
  let query;
  let indexUsed: 'externalId' | 'status' | 'category' | 'organizationId';

  if (args.externalId !== undefined) {
    const singleExternalId = args.externalId as string | number;
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_externalId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalId', singleExternalId),
      );
    indexUsed = 'externalId';
  } else if (args.status !== undefined) {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status),
      );
    indexUsed = 'status';
  } else if (args.category !== undefined) {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_category', (q) =>
        q.eq('organizationId', args.organizationId).eq('category', args.category),
      );
    indexUsed = 'category';
  } else {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );
    indexUsed = 'organizationId';
  }

  // Create filter for fields not covered by the selected index
  const filter = (product: Doc<'products'>): boolean => {
    if (indexUsed === 'externalId') {
      if (args.status !== undefined && product.status !== args.status) return false;
      if (args.category !== undefined && product.category !== args.category) return false;
    } else if (indexUsed === 'status') {
      if (args.category !== undefined && product.category !== args.category) return false;
    }
    return true;
  };

  return paginateWithFilter(query.order('desc'), {
    numItems,
    cursor,
    filter,
  });
}
