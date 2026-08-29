/**
 * Query products with flexible filtering and pagination support (internal operation)
 *
 * Uses smart index selection based on available filters:
 * - externalId (single): by_organizationId_and_externalId
 * - status: by_organizationId_and_status
 * - category: by_organizationId_and_category
 * - default: by_organizationId
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  paginateWithFilter,
  type CursorPaginatedResult,
} from '../lib/pagination';
import { productsSearchStrategy } from '../lib/search/strategies/products';
import { matchesAnyWord } from '../lib/search/word_match';
import type { ProductStatus } from './types';

export interface QueryProductsArgs {
  organizationId: string;
  externalId?: string | number | Array<string | number>;
  status?: ProductStatus;
  category?: string;
  minStock?: number;
  /** Case-insensitive contains-match over name, description, category, tags,
   * externalId and translated name/description — the products counterpart of
   * `queryContacts`' searchTerm. */
  searchTerm?: string;
  /**
   * Also match individual WORDS of `searchTerm`, not only the whole phrase.
   * Off by default, so the products page searches exactly as it does today.
   * The chat leg opts in, because it passes a question rather than a term.
   */
  matchWords?: boolean;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

function matchesSearchTerm(
  product: Doc<'products'>,
  searchLower: string,
  wordTerm?: string,
): boolean {
  // Words first — the cheaper test, and the one a question usually hits. The
  // phrase checks below still run, and they are what reach translations.
  if (
    wordTerm !== undefined &&
    matchesAnyWord(product, productsSearchStrategy, wordTerm)
  ) {
    return true;
  }
  if (product.name.toLowerCase().includes(searchLower)) return true;
  if (product.description?.toLowerCase().includes(searchLower)) return true;
  if (product.category?.toLowerCase().includes(searchLower)) return true;
  if (product.tags?.some((tag) => tag.toLowerCase().includes(searchLower))) {
    return true;
  }
  if (
    product.externalId !== undefined &&
    String(product.externalId).toLowerCase().includes(searchLower)
  ) {
    return true;
  }
  return (product.translations ?? []).some(
    (translation) =>
      translation.name?.toLowerCase().includes(searchLower) ||
      translation.description?.toLowerCase().includes(searchLower),
  );
}

function buildQuery(ctx: QueryCtx, args: QueryProductsArgs) {
  const { organizationId } = args;

  if (args.externalId !== undefined && !Array.isArray(args.externalId)) {
    const { externalId } = args;
    return {
      query: ctx.db
        .query('products')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q.eq('organizationId', organizationId).eq('externalId', externalId),
        ),
      indexedFields: { externalId: true } as const,
    };
  }

  if (args.status !== undefined) {
    const { status } = args;
    return {
      query: ctx.db
        .query('products')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', status),
        ),
      indexedFields: { status: true } as const,
    };
  }

  if (args.category !== undefined) {
    const { category } = args;
    return {
      query: ctx.db
        .query('products')
        .withIndex('by_organizationId_and_category', (q) =>
          q.eq('organizationId', organizationId).eq('category', category),
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
    const externalIdArray = args.externalId;
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
      const { minStock } = args;
      products = products.filter(
        (p) => p.stock !== undefined && p.stock !== null && p.stock >= minStock,
      );
    }
    const arraySearchLower = args.searchTerm?.trim().toLowerCase();
    const wordTerm =
      args.matchWords === true ? args.searchTerm?.trim() : undefined;
    if (arraySearchLower) {
      products = products.filter((p) =>
        matchesSearchTerm(p, arraySearchLower, wordTerm),
      );
    }

    // Sort by creation time (newest first)
    products.sort((a, b) => b._creationTime - a._creationTime);

    // Apply cursor-based pagination
    const startIndex = cursor
      ? products.findIndex((p) => p._id === cursor) + 1
      : 0;
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

  const needsStatusFilter =
    !('status' in indexedFields) && args.status !== undefined;
  const needsCategoryFilter =
    !('category' in indexedFields) && args.category !== undefined;
  const needsMinStockFilter = args.minStock !== undefined;
  const searchLower = args.searchTerm?.trim().toLowerCase() || undefined;
  const wordTerm =
    args.matchWords === true ? args.searchTerm?.trim() : undefined;
  const needsFilter =
    needsStatusFilter ||
    needsCategoryFilter ||
    needsMinStockFilter ||
    searchLower !== undefined;

  const filter = needsFilter
    ? (product: Doc<'products'>): boolean => {
        if (needsStatusFilter && product.status !== args.status) return false;
        if (needsCategoryFilter && product.category !== args.category)
          return false;
        if (needsMinStockFilter) {
          if (
            product.stock === undefined ||
            product.stock === null ||
            (args.minStock !== undefined && product.stock < args.minStock)
          ) {
            return false;
          }
        }
        if (searchLower && !matchesSearchTerm(product, searchLower, wordTerm)) {
          return false;
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
