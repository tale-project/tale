/**
 * Remove a recommended product from an approval
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export interface RemoveRecommendedProductArgs {
  approvalId: Id<'approvals'>;
  productId: string;
}

export async function removeRecommendedProduct(
  ctx: MutationCtx,
  args: RemoveRecommendedProductArgs,
): Promise<void> {
  const approval = await ctx.db.get(args.approvalId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  // Only allow removing products from pending approvals
  if (approval.status !== 'pending') {
    throw new Error('Cannot modify products in non-pending approvals');
  }

  const metadata = (approval.metadata || {}) as Record<string, unknown>;
  const recommendedProducts = Array.isArray(metadata.recommendedProducts)
    ? (metadata.recommendedProducts as Array<Record<string, unknown>>)
    : [];

  // Filter out the product with the matching productId
  const updatedProducts = recommendedProducts.filter((product) => {
    const id = product['productId'];
    return id !== args.productId;
  });

  // Update the approval with the filtered products
  await ctx.db.patch(args.approvalId, {
    metadata: {
      ...metadata,
      recommendedProducts: updatedProducts,
    },
  });
}

