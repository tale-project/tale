/**
 * Type definitions for product operations
 */

import type { Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import {
  productItemValidator,
  productListResponseValidator,
  productSortByValidator,
  productStatusValidator,
  productTranslationValidator,
  sortOrderValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type ProductStatus = Infer<typeof productStatusValidator>;
export type ProductSortBy = Infer<typeof productSortByValidator>;
export type SortOrder = Infer<typeof sortOrderValidator>;
export type ProductTranslation = Infer<typeof productTranslationValidator>;
export type ProductItem = Infer<typeof productItemValidator>;
export type ProductListResponse = Infer<typeof productListResponseValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export interface CreateProductResult {
  success: boolean;
  productId: Id<'products'>;
}

export interface UpdateProductsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Array<Id<'products'>>;
}
