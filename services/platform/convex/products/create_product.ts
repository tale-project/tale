/**
 * Create a new product (internal operation)
 */

import { MutationCtx } from '../_generated/server';

import { CreateProductResult, ProductStatus } from './types';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: args.metadata as any,
  });

  return {
    success: true,
    productId,
  };
}
