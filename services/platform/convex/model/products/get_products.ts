/**
 * Get products with pagination, search, and filtering (public API)
 */

import { QueryCtx } from '../../_generated/server';

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

export async function getProducts(
  ctx: QueryCtx,
  args: GetProductsArgs,
): Promise<ProductListResponse> {
  const currentPage = args.currentPage ?? 1;
  const pageSize = args.pageSize ?? 10;
  const searchQuery = args.searchQuery?.trim() ?? '';
  const sortBy = args.sortBy ?? 'lastUpdated';
  const sortOrder = args.sortOrder ?? 'desc';

  try {
    // Query products for the organization
    let productsQuery = ctx.db
      .query('products')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    // Apply status filter if provided
    if (args.status) {
      productsQuery = productsQuery.filter((q) =>
        q.eq(q.field('status'), args.status),
      );
    }

    // Apply category filter if provided
    if (args.category) {
      productsQuery = productsQuery.filter((q) =>
        q.eq(q.field('category'), args.category),
      );
    }

    // Apply search filter if provided
    if (searchQuery) {
      productsQuery = productsQuery.filter((q) =>
        q.or(
          q.eq(q.field('name'), searchQuery),
          q.eq(q.field('description'), searchQuery),
          q.eq(q.field('category'), searchQuery),
        ),
      );
    }

    // Get all products for counting and sorting
    const allProducts = await productsQuery.collect();
    const total = allProducts.length;

    // Sort products
    const sortedProducts = allProducts.sort((a, b) => {
      let aValue: string | number, bValue: string | number;

      switch (sortBy) {
        case 'name':
          aValue = a.name?.toLowerCase() || '';
          bValue = b.name?.toLowerCase() || '';
          break;
        case 'createdAt':
          aValue = a._creationTime;
          bValue = b._creationTime;
          break;
        case 'lastUpdated':
          aValue = a.lastUpdated || a._creationTime;
          bValue = b.lastUpdated || b._creationTime;
          break;
        case 'stock':
          aValue = a.stock || 0;
          bValue = b.stock || 0;
          break;
        case 'price':
          aValue = a.price || 0;
          bValue = b.price || 0;
          break;
        default:
          aValue = a.lastUpdated || a._creationTime;
          bValue = b.lastUpdated || b._creationTime;
      }

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });

    // Apply pagination
    const paginatedProducts = sortedProducts.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize,
    );

    // Map products without relationship counts
    const productsWithRelations = paginatedProducts.map((product) => ({
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
    }));

    const hasNextPage = currentPage * pageSize < total;

    return {
      products: productsWithRelations,
      total,
      hasNextPage,
      currentPage,
      pageSize,
    };
  } catch (error) {
    console.error('Error getting products:', error);
    return {
      products: [],
      total: 0,
      hasNextPage: false,
      currentPage: 1,
      pageSize: 10,
      error: 'Failed to retrieve products',
    };
  }
}
