/**
 * Get products with cursor-based pagination (for infinite scroll)
 *
 * Uses early termination to avoid reading all documents,
 * preventing the "Too many bytes read" error regardless of data volume.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { ProductStatus } from './types';

import { paginateWithFilter, DEFAULT_PAGE_SIZE } from '../lib/pagination';

export interface GetProductsCursorArgs {
  organizationId: string;
  numItems?: number;
  cursor: string | null;
  searchQuery?: string;
  category?: string;
  status?: ProductStatus;
}

interface ProductCursorItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  tags?: string[];
  status?: ProductStatus;
  lastUpdated: number;
  createdAt: number;
  translations?: Doc<'products'>['translations'];
  metadata?: Record<string, unknown>;
}

export interface CursorPaginatedProductsResult {
  page: ProductCursorItem[];
  isDone: boolean;
  continueCursor: string;
}

function mapProduct(product: Doc<'products'>): ProductCursorItem {
  return {
    id: product._id,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    stock: product.stock,
    price: product.price,
    currency: product.currency,
    category: product.category,
    tags: product.tags,
    status: product.status,
    lastUpdated: product.lastUpdated || product._creationTime,
    createdAt: product._creationTime,
    translations: product.translations,
    metadata: product.metadata,
  };
}

function buildQuery(ctx: QueryCtx, args: GetProductsCursorArgs) {
  const { organizationId } = args;

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

export async function getProductsCursor(
  ctx: QueryCtx,
  args: GetProductsCursorArgs,
): Promise<CursorPaginatedProductsResult> {
  const numItems = args.numItems ?? DEFAULT_PAGE_SIZE;
  const searchQuery = args.searchQuery?.trim().toLowerCase() ?? '';

  const { query, indexedFields } = buildQuery(ctx, args);

  const needsCategoryFilter =
    !('category' in indexedFields) && args.category !== undefined;
  const needsSearch = searchQuery.length > 0;
  const needsFilter = needsCategoryFilter || needsSearch;

  const filter = needsFilter
    ? (product: Doc<'products'>): boolean => {
        if (needsCategoryFilter && product.category !== args.category)
          return false;
        if (needsSearch) {
          const nameMatch = product.name?.toLowerCase().includes(searchQuery);
          const descMatch = product.description
            ?.toLowerCase()
            .includes(searchQuery);
          const categoryMatch = product.category
            ?.toLowerCase()
            .includes(searchQuery);
          if (!nameMatch && !descMatch && !categoryMatch) return false;
        }
        return true;
      }
    : undefined;

  const result = await paginateWithFilter(query.order('desc'), {
    numItems,
    cursor: args.cursor,
    filter,
  });

  // Transform to ProductCursorItem format
  return {
    page: result.page.map(mapProduct),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
