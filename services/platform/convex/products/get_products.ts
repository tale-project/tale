/**
 * Get products with offset-based pagination, search, and filtering (public API)
 *
 * Optimization notes:
 * - Uses search index for name/description queries (most efficient)
 * - Uses sorted indexes for lastUpdated sorting (default sort)
 * - Falls back to async iteration with filter for other cases
 * - Paginates BEFORE collecting all data when possible
 */

import { QueryCtx } from '../_generated/server';
import { Doc } from '../_generated/dataModel';
import {
  normalizePaginationOptions,
  calculatePaginationMeta,
} from '../lib/pagination';
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

function matchesSearch(product: Doc<'products'>, searchQuery: string): boolean {
  if (!searchQuery) return true;
  return (
    product.name?.toLowerCase().includes(searchQuery) ||
    product.description?.toLowerCase().includes(searchQuery) ||
    product.category?.toLowerCase().includes(searchQuery) ||
    false
  );
}

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

function compareProducts(
  a: Doc<'products'>,
  b: Doc<'products'>,
  sortBy: ProductSortBy,
  sortOrder: SortOrder,
): number {
  const aValue = getSortValue(a, sortBy);
  const bValue = getSortValue(b, sortBy);
  const multiplier = sortOrder === 'asc' ? 1 : -1;
  return aValue > bValue ? multiplier : aValue < bValue ? -multiplier : 0;
}

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

export async function getProducts(
  ctx: QueryCtx,
  args: GetProductsArgs,
): Promise<ProductListResponse> {
  const { page: currentPage, pageSize } = normalizePaginationOptions({
    page: args.currentPage,
    pageSize: args.pageSize,
  });
  const searchQuery = args.searchQuery?.trim().toLowerCase() ?? '';
  const sortBy = args.sortBy ?? 'lastUpdated';
  const sortOrder = args.sortOrder ?? 'desc';

  // Fast path: Use search index when searchQuery is provided
  if (searchQuery) {
    return getProductsWithSearch(ctx, {
      ...args,
      searchQuery,
      currentPage,
      pageSize,
      sortBy,
      sortOrder,
    });
  }

  // Fast path: Use sorted index when sorting by lastUpdated (default)
  if (sortBy === 'lastUpdated' && !args.category) {
    return getProductsWithSortedIndex(ctx, {
      ...args,
      currentPage,
      pageSize,
      sortOrder,
    });
  }

  // Fallback: Use async iteration for other cases
  return getProductsWithIteration(ctx, {
    ...args,
    searchQuery,
    currentPage,
    pageSize,
    sortBy,
    sortOrder,
  });
}

/**
 * Use search index for name queries - most efficient for text search
 */
async function getProductsWithSearch(
  ctx: QueryCtx,
  args: GetProductsArgs & {
    searchQuery: string;
    currentPage: number;
    pageSize: number;
    sortBy: ProductSortBy;
    sortOrder: SortOrder;
  },
): Promise<ProductListResponse> {
  const { organizationId, status, category, searchQuery, currentPage, pageSize, sortBy, sortOrder } =
    args;

  // Use search index with optional filters
  const searchResults: Array<Doc<'products'>> = [];

  if (status !== undefined) {
    for await (const product of ctx.db
      .query('products')
      .withSearchIndex('search_products', (q) =>
        q
          .search('name', searchQuery)
          .eq('organizationId', organizationId)
          .eq('status', status),
      )) {
      searchResults.push(product);
    }
  } else {
    for await (const product of ctx.db
      .query('products')
      .withSearchIndex('search_products', (q) =>
        q.search('name', searchQuery).eq('organizationId', organizationId),
      )) {
      searchResults.push(product);
    }
  }

  // Apply category filter if specified (not in search index)
  let filtered = searchResults;
  if (category !== undefined) {
    filtered = searchResults.filter((p) => p.category === category);
  }

  // Also include description matches (search index only searches name)
  // Get products matching description that weren't found by name search
  const nameMatchIds = new Set(searchResults.map((p) => p._id));
  const descriptionMatches: Array<Doc<'products'>> = [];

  // Query for description matches using async iteration
  const baseQuery =
    status !== undefined
      ? ctx.db
          .query('products')
          .withIndex('by_organizationId_and_status', (q) =>
            q.eq('organizationId', organizationId).eq('status', status),
          )
      : ctx.db
          .query('products')
          .withIndex('by_organizationId', (q) =>
            q.eq('organizationId', organizationId),
          );

  for await (const product of baseQuery) {
    if (nameMatchIds.has(product._id)) continue;
    if (category !== undefined && product.category !== category) continue;
    if (product.description?.toLowerCase().includes(searchQuery)) {
      descriptionMatches.push(product);
    }
  }

  // Merge results
  filtered = [...filtered, ...descriptionMatches];

  const total = filtered.length;
  const { hasNextPage } = calculatePaginationMeta(total, currentPage, pageSize);

  // Sort and paginate
  filtered.sort((a, b) => compareProducts(a, b, sortBy, sortOrder));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = filtered.slice(startIndex, startIndex + pageSize);

  return {
    products: paginatedProducts.map(mapProduct),
    total,
    hasNextPage,
    currentPage,
    pageSize,
  };
}

/**
 * Use sorted index for lastUpdated sorting - efficient for default sort
 */
async function getProductsWithSortedIndex(
  ctx: QueryCtx,
  args: GetProductsArgs & {
    currentPage: number;
    pageSize: number;
    sortOrder: SortOrder;
  },
): Promise<ProductListResponse> {
  const { organizationId, status, currentPage, pageSize, sortOrder } = args;

  // Use sorted index based on status filter
  const query =
    status !== undefined
      ? ctx.db
          .query('products')
          .withIndex('by_org_status_lastUpdated', (q) =>
            q.eq('organizationId', organizationId).eq('status', status),
          )
          .order(sortOrder)
      : ctx.db
          .query('products')
          .withIndex('by_org_lastUpdated', (q) =>
            q.eq('organizationId', organizationId),
          )
          .order(sortOrder);

  // Collect all for accurate total count (needed for pagination UI)
  // This is a tradeoff: accurate counts require reading all documents
  const allProducts: Array<Doc<'products'>> = [];
  for await (const product of query) {
    allProducts.push(product);
  }

  const total = allProducts.length;
  const { hasNextPage } = calculatePaginationMeta(total, currentPage, pageSize);

  // Apply pagination (already sorted by index)
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = allProducts.slice(startIndex, startIndex + pageSize);

  return {
    products: paginatedProducts.map(mapProduct),
    total,
    hasNextPage,
    currentPage,
    pageSize,
  };
}

/**
 * Fallback to async iteration for complex filters/sorts
 */
async function getProductsWithIteration(
  ctx: QueryCtx,
  args: GetProductsArgs & {
    searchQuery: string;
    currentPage: number;
    pageSize: number;
    sortBy: ProductSortBy;
    sortOrder: SortOrder;
  },
): Promise<ProductListResponse> {
  const {
    organizationId,
    status,
    category,
    searchQuery,
    currentPage,
    pageSize,
    sortBy,
    sortOrder,
  } = args;

  // Build base query with best available index
  let query;
  if (status !== undefined) {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', status),
      );
  } else if (category !== undefined) {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId_and_category', (q) =>
        q.eq('organizationId', organizationId).eq('category', category),
      );
  } else {
    query = ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      );
  }

  const matchingProducts: Array<Doc<'products'>> = [];

  for await (const product of query) {
    // Apply category filter if both status and category are specified
    if (
      status !== undefined &&
      category !== undefined &&
      product.category !== category
    ) {
      continue;
    }

    if (!matchesSearch(product, searchQuery)) {
      continue;
    }

    matchingProducts.push(product);
  }

  const total = matchingProducts.length;
  const { hasNextPage } = calculatePaginationMeta(total, currentPage, pageSize);

  // Sort and paginate
  matchingProducts.sort((a, b) => compareProducts(a, b, sortBy, sortOrder));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = matchingProducts.slice(
    startIndex,
    startIndex + pageSize,
  );

  return {
    products: paginatedProducts.map(mapProduct),
    total,
    hasNextPage,
    currentPage,
    pageSize,
  };
}
