import type { MutationCtx } from '../_generated/server';
import type { ConvexJsonValue } from '../lib/validators/json';
import { createProductWithTranslations } from './create_product_with_translations';
import type { ProductStatus } from './types';

export interface BulkCreateProductData {
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  status?: ProductStatus;
}

export interface BulkCreateProductsResult {
  success: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    errorCode: string;
    product: ConvexJsonValue;
  }>;
}

class BulkCreateError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message);
  }
}

export async function bulkCreateProducts(
  ctx: MutationCtx,
  organizationId: string,
  products: BulkCreateProductData[],
): Promise<BulkCreateProductsResult> {
  const results: BulkCreateProductsResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < products.length; i++) {
    const productData = products[i];

    try {
      await createProductWithTranslations(ctx, {
        organizationId,
        name: productData.name,
        description: productData.description,
        imageUrl: productData.imageUrl,
        stock: productData.stock,
        price: productData.price,
        currency: productData.currency,
        category: productData.category,
        status: productData.status,
      });

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode:
          error instanceof BulkCreateError ? error.errorCode : 'unknown',
        product: productData,
      });
    }
  }

  return results;
}
