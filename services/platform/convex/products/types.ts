import type { Infer } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import {
  productItemValidator,
  productStatusValidator,
  productTranslationValidator,
} from './validators';

export type ProductStatus = Infer<typeof productStatusValidator>;
export type ProductTranslation = Infer<typeof productTranslationValidator>;
export type ProductItem = Infer<typeof productItemValidator>;

export interface CreateProductResult {
  success: boolean;
  productId: Id<'products'>;
}

export interface UpdateProductsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Array<Id<'products'>>;
}
