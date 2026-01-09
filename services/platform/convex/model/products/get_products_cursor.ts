/**
 * Get products with cursor-based pagination (for infinite scroll)
 *
 * Uses early termination to avoid reading all documents,
 * preventing the "Too many bytes read" error regardless of data volume.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { paginateWithFilter, DEFAULT_PAGE_SIZE } from '../../lib/pagination';
import type { ProductStatus } from './types';

export interface GetProductsCursorArgs {
  organizationId: string;
  numItems?: number;
  cursor: string | null;
  searchQuery?: string;
  category?: string;
  status?: ProductStatus;
}

export interface ProductCursorItem {
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

export async function getProductsCursor(
  ctx: QueryCtx,
  args: GetProductsCursorArgs,
): Promise<CursorPaginatedProductsResult> {
  const numItems = args.numItems ?? DEFAULT_PAGE_SIZE;
  const searchQuery = args.searchQuery?.trim().toLowerCase() ?? '';

  // Pre-compute filter sets
  const statusFilter = args.status;
  const categoryFilter = args.category;

  // Select the best index based on available filters
  let query;

  if (statusFilter !== undefined) {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', statusFilter),
      );
  } else if (categoryFilter !== undefined) {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_category', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('category', categoryFilter),
      );
  } else {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );
  }

  // Filter function for fields not covered by the selected index
  const filter = (product: Doc<'products'>): boolean => {
    // Category filter (if not using category index)
    if (
      statusFilter !== undefined &&
      categoryFilter !== undefined &&
      product.category !== categoryFilter
    ) {
      return false;
    }

    // Search filter (search in name and description)
    if (searchQuery) {
      const nameMatch = product.name?.toLowerCase().includes(searchQuery);
      const descMatch = product.description?.toLowerCase().includes(searchQuery);
      const categoryMatch = product.category?.toLowerCase().includes(searchQuery);

      if (!nameMatch && !descMatch && !categoryMatch) {
        return false;
      }
    }

    return true;
  };

  // Use paginateWithFilter for early termination
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
