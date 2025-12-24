/**
 * Get products with offset-based pagination, search, and filtering (public API)
 *
 * Uses offset-based pagination for traditional page navigation with total counts.
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';
import { normalizePaginationOptions, calculatePaginationMeta } from '../../lib/pagination';
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
  const { page: currentPage, pageSize } = normalizePaginationOptions({
    page: args.currentPage,
    pageSize: args.pageSize,
  });
  const searchQuery = args.searchQuery?.trim().toLowerCase() ?? '';
  const sortBy = args.sortBy ?? 'lastUpdated';
  const sortOrder = args.sortOrder ?? 'desc';

  const query = buildQuery(ctx, args);
  const matchingProducts: Array<Doc<'products'>> = [];

  for await (const product of query) {
    // Apply category filter if both status and category are specified
    if (
      args.status !== undefined &&
      args.category !== undefined &&
      product.category !== args.category
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
  const paginatedProducts = matchingProducts.slice(startIndex, startIndex + pageSize);

  return {
    products: paginatedProducts.map(mapProduct),
    total,
    hasNextPage,
    currentPage,
    pageSize,
  };
}
