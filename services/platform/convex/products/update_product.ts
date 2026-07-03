import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { assertUniqueProductName } from './assert_unique_product_name';
import { assertSupportedProductLocale } from './locale_validation';
import type { ProductStatus, ProductTranslation } from './types';
import { validateProductName } from './validate_product_name';

export interface UpdateProductArgs {
  productId: Id<'products'>;
  name?: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  tags?: Array<string>;
  status?: ProductStatus;
  translations?: Array<ProductTranslation>;
  metadata?: unknown;
}

export async function updateProduct(
  ctx: MutationCtx,
  args: UpdateProductArgs,
): Promise<Id<'products'>> {
  for (const translation of args.translations ?? []) {
    assertSupportedProductLocale(translation.language);
  }

  const product = await ctx.db.get(args.productId);
  if (!product) {
    throw new Error('Product not found');
  }

  if (args.name !== undefined) {
    await assertUniqueProductName(
      ctx,
      product.organizationId,
      args.name,
      product._id,
    );
  }

  const now = Date.now();
  const updates: Partial<Doc<'products'>> = {
    lastUpdated: now,
  };

  if (args.name !== undefined) updates.name = validateProductName(args.name);
  if (args.description !== undefined) updates.description = args.description;
  if (args.imageUrl !== undefined) updates.imageUrl = args.imageUrl;
  if (args.stock !== undefined) updates.stock = args.stock;
  if (args.price !== undefined) updates.price = args.price;
  if (args.currency !== undefined) updates.currency = args.currency;
  if (args.category !== undefined) updates.category = args.category;
  if (args.tags !== undefined) updates.tags = args.tags;
  if (args.status !== undefined) updates.status = args.status;
  if (args.translations !== undefined) updates.translations = args.translations;
  if (args.metadata !== undefined)
    updates.metadata = toConvexJsonRecord(args.metadata);

  await ctx.db.patch(args.productId, updates);
  return args.productId;
}
