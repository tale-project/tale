/**
 * Convex validators for product operations
 */

import { v } from 'convex/values';

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
