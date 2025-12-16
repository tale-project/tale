/**
 * Query products with flexible filtering and pagination support (internal operation)
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

  // Use appropriate index based on filters
  let products: Array<Doc<'products'>>;

  if (args.externalId !== undefined) {
    if (Array.isArray(args.externalId)) {
      // For array of externalIds, execute multiple targeted queries
      const externalIdArray = args.externalId as Array<string | number>;
      const productPromises = externalIdArray.map((externalId) =>
        ctx.db
          .query('products')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('externalId', externalId),
          )
          .collect(),
      );

      // Execute all queries in parallel and flatten results
      const productArrays = await Promise.all(productPromises);
      products = productArrays.flat();

      // Remove duplicates (in case same product has multiple matching externalIds)
      const seenIds = new Set<string>();
      products = products.filter((product) => {
        if (seenIds.has(product._id)) {
          return false;
        }
        seenIds.add(product._id);
        return true;
      });
    } else {
      // Single externalId - use the specific index
      const singleExternalId = args.externalId as string | number;
      products = await ctx.db
        .query('products')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('externalId', singleExternalId),
        )
        .collect();
    }
  } else if (args.status !== undefined) {
    // Use by_organizationId_and_status index
    products = await ctx.db
      .query('products')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status),
      )
      .collect();
  } else if (args.category !== undefined) {
    // Use by_organizationId_and_category index
    products = await ctx.db
      .query('products')
      .withIndex('by_organizationId_and_category', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('category', args.category),
      )
      .collect();
  } else {
    // Use by_organizationId index
    products = await ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  }

  // Apply additional filters in code
  if (args.status !== undefined && args.externalId !== undefined) {
    // Only apply status filter if we didn't already filter by externalId array
    // (array case already filters by organization, so we need status filter)
    if (Array.isArray(args.externalId)) {
      products = products.filter((p) => p.status === args.status);
    } else {
      // Single externalId case - status filter needed
      products = products.filter((p) => p.status === args.status);
    }
  }

  if (
    args.category !== undefined &&
    (args.externalId !== undefined || args.status !== undefined)
  ) {
    // Apply category filter when other filters are present
    products = products.filter((p) => p.category === args.category);
  }

  // Sort by creation time (newest first) for consistent pagination
  products.sort((a, b) => b._creationTime - a._creationTime);

  // Apply cursor-based pagination
  const paginationOpts = args.paginationOpts;
  const startIndex = paginationOpts.cursor
    ? products.findIndex((p) => p._id === paginationOpts.cursor) + 1
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
