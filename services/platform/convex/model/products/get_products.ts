/**
 * Get products with pagination, search, and filtering (public API)
 *
 * Uses async iteration (for await) instead of .collect() for memory efficiency.
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';

import {
  ProductListResponse,
  ProductStatus,
  ProductSortBy,
  SortOrder,
} from './types';

export interface GetProductsArgs {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
  searchQuery?: string;
  category?: string;
  status?: ProductStatus;
  sortBy?: ProductSortBy;
  sortOrder?: SortOrder;
}

/**
 * Check if a product matches the search query
 */
function matchesSearch(product: Doc<'products'>, searchQuery: string): boolean {
  if (!searchQuery) return true;
  return (
    product.name?.toLowerCase().includes(searchQuery) ||
    product.description?.toLowerCase().includes(searchQuery) ||
    product.category?.toLowerCase().includes(searchQuery) ||
    false
  );
}

/**
 * Get sort value for a product based on sortBy field
 */
function getSortValue(
  product: Doc<'products'>,
  sortBy: ProductSortBy,
): string | number {
  switch (sortBy) {
    case 'name':
      return product.name?.toLowerCase() || '';
    case 'createdAt':
      return product._creationTime;
    case 'lastUpdated':
      return product.lastUpdated || product._creationTime;
    case 'stock':
      return product.stock || 0;
    case 'price':
      return product.price || 0;
    default:
      return product.lastUpdated || product._creationTime;
  }
}

/**
 * Compare two products for sorting
 */
function compareProducts(
  a: Doc<'products'>,
  b: Doc<'products'>,
  sortBy: ProductSortBy,
  sortOrder: SortOrder,
): number {
  const aValue = getSortValue(a, sortBy);
  const bValue = getSortValue(b, sortBy);

  if (sortOrder === 'asc') {
    return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
  } else {
    return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
  }
}

/**
 * Map a product document to the response format
 */
function mapProduct(product: Doc<'products'>) {
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

/**
 * Build the database query with appropriate index based on filters.
 * Priority: status index > category index > organizationId index
 * When both status and category are specified, use status index (category filtered in iteration)
 */
function buildQuery(ctx: QueryCtx, args: GetProductsArgs) {
  const { organizationId, status, category } = args;

  if (status !== undefined) {
    return ctx.db
      .query('products')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', status),
      );
  }

  if (category !== undefined) {
    return ctx.db
      .query('products')
      .withIndex('by_organizationId_and_category', (q) =>
        q.eq('organizationId', organizationId).eq('category', category),
      );
  }

  return ctx.db
    .query('products')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    );
}

export async function getProducts(
  ctx: QueryCtx,
  args: GetProductsArgs,
): Promise<ProductListResponse> {
  const currentPage = args.currentPage ?? 1;
  const pageSize = args.pageSize ?? 10;
  const searchQuery = args.searchQuery?.trim().toLowerCase() ?? '';
  const sortBy = args.sortBy ?? 'lastUpdated';
  const sortOrder = args.sortOrder ?? 'desc';

  const query = buildQuery(ctx, args);
  const matchingProducts: Array<Doc<'products'>> = [];

  for await (const product of query) {
    // Apply category filter if both status and category are specified
    // (status index is used, category filtered in code)
    if (
      args.status !== undefined &&
      args.category !== undefined &&
      product.category !== args.category
    ) {
      continue;
    }

    // Apply search filter
    if (!matchesSearch(product, searchQuery)) {
      continue;
    }

    matchingProducts.push(product);
  }

  const total = matchingProducts.length;

  // Sort products
  matchingProducts.sort((a, b) => compareProducts(a, b, sortBy, sortOrder));

  // Apply pagination
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = matchingProducts.slice(
    startIndex,
    startIndex + pageSize,
  );

  const hasNextPage = currentPage * pageSize < total;

  return {
    products: paginatedProducts.map(mapProduct),
    total,
    hasNextPage,
    currentPage,
    pageSize,
  };
}
