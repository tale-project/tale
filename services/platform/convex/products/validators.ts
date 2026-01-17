/**
 * Convex validators for product operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  productStatusSchema,
  productSortBySchema,
  productTranslationSchema,
  productItemSchema,
  productListResponseSchema,
  productDocSchema,
  createProductArgsSchema,
  updateProductArgsSchema,
} from '../../lib/shared/schemas/products';

export {
  productStatusSchema,
  productSortBySchema,
  productTranslationSchema,
  productItemSchema,
  productListResponseSchema,
} from '../../lib/shared/schemas/products';

export const productStatusValidator = zodToConvex(productStatusSchema);
export const productSortByValidator = zodToConvex(productSortBySchema);
export const productTranslationValidator = zodToConvex(productTranslationSchema);
export const productItemValidator = zodToConvex(productItemSchema);
export const productListResponseValidator = zodToConvex(productListResponseSchema);
export const productDocValidator = zodToConvex(productDocSchema);
export const createProductArgsValidator = zodToConvex(createProductArgsSchema);
export const updateProductArgsValidator = zodToConvex(updateProductArgsSchema);
