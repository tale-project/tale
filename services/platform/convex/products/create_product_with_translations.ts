import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { ProductStatus, ProductTranslation } from './types';

export interface CreateProductWithTranslationsArgs {
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

export async function createProductWithTranslations(
  ctx: MutationCtx,
  args: CreateProductWithTranslationsArgs,
): Promise<Id<'products'>> {
  const now = Date.now();

  return await ctx.db.insert('products', {
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
    metadata: args.metadata as Record<string, unknown>,
    lastUpdated: now,
  });
}
