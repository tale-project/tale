/**
 * Type definitions for product operations
 */

import { v } from 'convex/values';
import { Id } from '../../_generated/dataModel';

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Product translation validator
 */
export const productTranslationValidator = v.object({
  language: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(v.any()),
  createdAt: v.optional(v.number()),
  lastUpdated: v.number(),
});

/**
 * Product status validator
 */
export const productStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('draft'),
  v.literal('archived'),
);

/**
 * Product relationship type validator
 */

/**
 * Product sort field validator
 */
export const productSortByValidator = v.union(
  v.literal('name'),
  v.literal('createdAt'),
  v.literal('lastUpdated'),
  v.literal('stock'),
  v.literal('price'),
);

/**
 * Sort order validator
 */
export const sortOrderValidator = v.union(v.literal('asc'), v.literal('desc'));

/**
 * Product item validator (for responses)
 */
export const productItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  lastUpdated: v.number(),
  createdAt: v.number(),
  relatedProductsCount: v.optional(v.number()),
  translations: v.optional(v.array(productTranslationValidator)),
  metadata: v.optional(v.record(v.string(), v.any())),
});

/**
 * Product list response validator
 */
export const productListResponseValidator = v.object({
  products: v.array(productItemValidator),
  total: v.number(),
  hasNextPage: v.boolean(),
  currentPage: v.number(),
  pageSize: v.number(),
  error: v.optional(v.string()),
});

/**
 * Product relationship validator
 */

// =============================================================================
// TYPESCRIPT TYPES
// =============================================================================

export type ProductStatus = 'active' | 'inactive' | 'draft' | 'archived';
export type ProductSortBy =
  | 'name'
  | 'createdAt'
  | 'lastUpdated'
  | 'stock'
  | 'price';
export type SortOrder = 'asc' | 'desc';

export interface ProductTranslation {
  language: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: Array<string>;
  metadata?: unknown;
  createdAt?: number;
  lastUpdated: number;
}

export interface CreateProductResult {
  success: boolean;
  productId: Id<'products'>;
}

export interface UpdateProductsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Array<Id<'products'>>;
}

export interface ProductItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  tags?: Array<string>;
  status?: ProductStatus;
  lastUpdated: number;
  createdAt: number;
  relatedProductsCount?: number;
  translations?: Array<ProductTranslation>;
  metadata?: Record<string, unknown>;
}

export interface ProductListResponse {
  products: Array<ProductItem>;
  total: number;
  hasNextPage: boolean;
  currentPage: number;
  pageSize: number;
  error?: string;
}
