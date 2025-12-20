/**
 * Query products with flexible filtering and pagination support (internal operation)
 *
 * Optimized to use async iteration with early termination instead of .collect()
 * for better memory efficiency and performance with large datasets.
 *
 * Note: For externalId array queries, we still use parallel queries since
 * each externalId lookup is a targeted index query (efficient).
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';

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

export interface QueryProductsResult {
  items: Array<Doc<'products'>>;
  isDone: boolean;
  continueCursor: string | null;
  count: number;
}

export async function queryProducts(
  ctx: QueryCtx,
  args: QueryProductsArgs,
): Promise<QueryProductsResult> {
  const numItems = args.paginationOpts.numItems;
  const cursor = args.paginationOpts.cursor;

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

    // Execute all queries in parallel
    const productResults = await Promise.all(productPromises);

    // Filter out nulls and apply additional filters
    let products = productResults.filter(
      (p): p is Doc<'products'> => p !== null,
    );

    // Remove duplicates
    const seenIds = new Set<string>();
    products = products.filter((product) => {
      if (seenIds.has(product._id)) {
        return false;
      }
      seenIds.add(product._id);
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
    const startIndex = cursor
      ? products.findIndex((p) => p._id === cursor) + 1
      : 0;
    const endIndex = startIndex + numItems;
    const paginatedProducts = products.slice(startIndex, endIndex);

    return {
      items: paginatedProducts,
      isDone: endIndex >= products.length,
      continueCursor:
        paginatedProducts.length > 0
          ? paginatedProducts[paginatedProducts.length - 1]._id
          : null,
      count: paginatedProducts.length,
    };
  }

  // For other cases, use async iteration with early termination
  let query;
  let indexUsed: 'externalId' | 'status' | 'category' | 'organizationId';

  if (args.externalId !== undefined) {
    // Single externalId - use the specific index
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
        q
          .eq('organizationId', args.organizationId)
          .eq('category', args.category),
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

  // Use async iteration with early termination and descending order
  const orderedQuery = query.order('desc');

  const products: Array<Doc<'products'>> = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const product of orderedQuery) {
    // Skip until we find the cursor
    if (!foundCursor) {
      if (product._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply additional filters not covered by the index
    if (indexUsed === 'externalId') {
      if (args.status !== undefined && product.status !== args.status) {
        continue;
      }
      if (args.category !== undefined && product.category !== args.category) {
        continue;
      }
    } else if (indexUsed === 'status') {
      if (args.category !== undefined && product.category !== args.category) {
        continue;
      }
    }
    // 'category' and 'organizationId' indexes don't need additional filtering

    products.push(product);

    // Check if we have enough items
    if (products.length >= numItems) {
      hasMore = true;
      break;
    }
  }

  return {
    items: products,
    isDone: !hasMore,
    continueCursor:
      products.length > 0 ? products[products.length - 1]._id : null,
    count: products.length,
  };
}
