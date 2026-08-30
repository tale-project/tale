import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/** Normalize a product name for ambiguity-detection: trimmed, case-folded. */
function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Throw `DUPLICATE_PRODUCT_NAME` if another product in the same org already
 * uses `name` (case-insensitive, trimmed). A product's name IS its identity —
 * there is no separate slug — so a duplicate name is a genuine ambiguity, not
 * a cosmetic clash. `excludeProductId` skips the row being renamed so an
 * in-place edit that keeps the same name still passes.
 */
export async function assertUniqueProductName(
  ctx: MutationCtx,
  organizationId: string,
  name: string,
  excludeProductId?: Id<'products'>,
): Promise<void> {
  const target = normalizeProductName(name);
  if (target.length === 0) return;
  for await (const product of ctx.db
    .query('products')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )) {
    if (excludeProductId && product._id === excludeProductId) continue;
    if (normalizeProductName(product.name) === target) {
      throw new AppError({
        code: 'DUPLICATE_PRODUCT_NAME',
        message: `A product named "${name.trim()}" already exists.`,
        userMessage: `A product named "${name.trim()}" already exists.`,
      });
    }
  }
}
