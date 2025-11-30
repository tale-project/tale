/**
 * Create a new product (public API)
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { ProductStatus, ProductTranslation } from './types';

export interface CreateProductPublicArgs {
  organizationId: string;
  name: string;
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

export async function createProductPublic(
  ctx: MutationCtx,
  args: CreateProductPublicArgs,
): Promise<Id<'products'>> {
  const now = Date.now();

  const productId = await ctx.db.insert('products', {
    organizationId: args.organizationId,
    name: args.name,
    description: args.description,
    imageUrl: args.imageUrl,
    stock: args.stock,
    price: args.price,
    currency: args.currency || 'USD',
    category: args.category,
    tags: args.tags || [],
    status: args.status || 'draft',
    translations: args.translations || [],
    metadata: args.metadata,
    lastUpdated: now,
  });

  return productId;
}
