/**
 * Convex validators for product operations
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	productStatusSchema,
	productSortBySchema,
	productItemSchema,
	productListResponseSchema,
} from '../../../lib/shared/validators/products';

export * from '../common/validators';
export * from '../../../lib/shared/validators/products';

export const productStatusValidator = zodToConvex(productStatusSchema);
export const productSortByValidator = zodToConvex(productSortBySchema);
export const productItemValidator = zodToConvex(productItemSchema);
export const productListResponseValidator = zodToConvex(productListResponseSchema);
