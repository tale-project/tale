import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { CreateProductResult, ProductStatus } from './types';

export interface CreateProductArgs {
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
  externalId?: string | number;
  metadata?: unknown;
}

export async function createProduct(
  ctx: MutationCtx,
  args: CreateProductArgs,
): Promise<CreateProductResult> {
  const productId = await ctx.db.insert('products', {
    organizationId: args.organizationId,
    name: args.name,
    description: args.description,
    imageUrl: args.imageUrl,
    stock: args.stock,
    price: args.price,
    currency: args.currency,
    category: args.category,
    tags: args.tags,
    status: args.status,
    externalId: args.externalId,
     
    metadata: args.metadata as Doc<'products'>['metadata'],
  });

  return {
    success: true,
    productId,
  };
}
