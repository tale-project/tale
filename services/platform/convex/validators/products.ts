/**
 * Convex validators for product operations
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  productStatusSchema,
  productSortBySchema,
  productItemSchema,
  productListResponseSchema,
  productDocSchema,
  productTranslationSchema,
  createProductArgsSchema,
  updateProductArgsSchema,
} from '../../lib/shared/schemas/products';

export const productStatusValidator = zodToConvex(productStatusSchema);
export const productSortByValidator = zodToConvex(productSortBySchema);
export const productItemValidator = zodToConvex(productItemSchema);
export const productListResponseValidator = zodToConvex(productListResponseSchema);
export const productDocValidator = zodToConvex(productDocSchema);
export const productTranslationValidator = zodToConvex(productTranslationSchema);
export const createProductArgsValidator = zodToConvex(createProductArgsSchema);
export const updateProductArgsValidator = zodToConvex(updateProductArgsSchema);
