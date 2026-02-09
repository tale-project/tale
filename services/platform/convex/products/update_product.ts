import type { ConvexJsonRecord } from '../../lib/shared/schemas/utils/json-value';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ProductStatus, ProductTranslation } from './types';

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
  const product = await ctx.db.get(args.productId);
  if (!product) {
    throw new Error('Product not found');
  }

  const now = Date.now();
  const updates: Partial<Doc<'products'>> = {
    lastUpdated: now,
  };

  if (args.name !== undefined) updates.name = args.name;
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
    updates.metadata = args.metadata as ConvexJsonRecord;

  await ctx.db.patch(args.productId, updates);
  return args.productId;
}
