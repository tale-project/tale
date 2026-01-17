/**
 * Convex validators for product operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  productStatusSchema,
  productSortBySchema,
} from '../../lib/shared/schemas/products';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  productStatusSchema,
  productSortBySchema,
  productTranslationSchema,
  productItemSchema,
  productListResponseSchema,
} from '../../lib/shared/schemas/products';

// Simple schemas without z.lazy()
export const productStatusValidator = zodToConvex(productStatusSchema);
export const productSortByValidator = zodToConvex(productSortBySchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const productTranslationValidator = v.object({
  language: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  createdAt: v.optional(v.number()),
  lastUpdated: v.number(),
});

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
  metadata: v.optional(jsonRecordValidator),
});

export const productListResponseValidator = v.object({
  products: v.array(productItemValidator),
  total: v.number(),
  hasNextPage: v.boolean(),
  currentPage: v.number(),
  pageSize: v.number(),
  error: v.optional(v.string()),
});

export const productDocValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  translations: v.optional(v.array(productTranslationValidator)),
  lastUpdated: v.optional(v.number()),
  externalId: v.optional(v.union(v.string(), v.number())),
  metadata: v.optional(jsonRecordValidator),
});

export const createProductArgsValidator = v.object({
  organizationId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  externalId: v.optional(v.union(v.string(), v.number())),
  metadata: v.optional(jsonRecordValidator),
});

export const updateProductArgsValidator = v.object({
  productId: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  translations: v.optional(v.array(productTranslationValidator)),
  metadata: v.optional(jsonRecordValidator),
});
