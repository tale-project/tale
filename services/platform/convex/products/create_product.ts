import type { MutationCtx } from '../_generated/server';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { validateProductFields } from './field_limits';
import type { CreateProductResult, ProductStatus } from './types';
import { validateProductName } from './validate_product_name';

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
  validateProductFields(args);
  const name = validateProductName(args.name);

  const productId = await ctx.db.insert('products', {
    organizationId: args.organizationId,
    name,
    description: args.description,
    imageUrl: args.imageUrl,
    stock: args.stock,
    price: args.price,
    currency: args.currency,
    category: args.category,
    tags: args.tags,
    status: args.status,
    externalId: args.externalId,

    metadata: toConvexJsonRecord(args.metadata),
  });

  return {
    success: true,
    productId,
  };
}
