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

export type ProductStatus = Infer<typeof productStatusValidator>;
export type ProductSortBy = Infer<typeof productSortByValidator>;
export type SortOrder = Infer<typeof sortOrderValidator>;
export type ProductTranslation = Infer<typeof productTranslationValidator>;
export type ProductItem = Infer<typeof productItemValidator>;
export type ProductListResponse = Infer<typeof productListResponseValidator>;

export interface CreateProductResult {
  success: boolean;
  productId: Id<'products'>;
}

export interface UpdateProductsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Array<Id<'products'>>;
}
