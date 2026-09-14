import type { TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  basePath,
  publicOrigin,
  siteOrigins,
} from '../core/lib/helpers/public_origin.ts';
import { PRODUCT_IMAGE_URL_MAX } from '../core/products/field_limits.ts';
import {
  productImageId,
  validateProductImageBinding,
} from '../domains/products/images.ts';
import { productImageUrlSchema } from '../domains/products/input-schema.ts';
import {
  ProductError,
  type ProductRow,
  type ProductScope,
} from '../domains/products/service.ts';

/** The REST contract remains an absolute URI, including app-uploaded images. */
export function productRestPayload(
  req: Request,
  product: ProductRow,
): ProductRow {
  if (
    product.imageUrl === null ||
    productImageId(product.imageUrl, product.organizationId) === null
  )
    return product;
  return { ...product, imageUrl: `${publicOrigin(req)}${product.imageUrl}` };
}

/**
 * A caller may replay the protected URL returned by GET, even on a private
 * deployment. Only this deployment's exact image path is normalized; every
 * pasted external URL still passes the shared public-host policy. Aliases
 * configured for the same deployment share the same org-bound stored path.
 */
export function productRestImageSchema(req: Request, organizationId: string) {
  const origins = siteOrigins();
  if (origins.length === 0) origins.push(publicOrigin(req));
  const prefix = `${basePath()}/api/app/products/images/`;
  return z
    .string()
    .trim()
    .max(PRODUCT_IMAGE_URL_MAX)
    .transform((value, ctx) => {
      const parsed = URL.canParse(value) ? new URL(value) : null;
      if (
        parsed !== null &&
        origins.includes(parsed.origin) &&
        parsed.pathname.startsWith(prefix)
      ) {
        const relative = value.startsWith(parsed.origin)
          ? value.slice(parsed.origin.length)
          : '';
        if (productImageId(relative, organizationId) !== null) return relative;
        ctx.addIssue({
          code: 'custom',
          message: 'must name an uploaded image in this organization',
        });
        return z.NEVER;
      }
      const external = productImageUrlSchema.safeParse(value);
      if (!external.success) {
        for (const issue of external.error.issues) ctx.addIssue({ ...issue });
        return z.NEVER;
      }
      return external.data;
    })
    .nullable()
    .optional();
}

/** The file lock also serializes a product binding against file deletion. */
export async function validateRestProductImage(
  tx: TransactionSql,
  scope: ProductScope,
  imageUrl: string | null | undefined,
): Promise<void> {
  try {
    await validateProductImageBinding(tx, scope, imageUrl);
  } catch (error) {
    if (
      error instanceof ProductError &&
      error.code === 'PRODUCT_IMAGE_NOT_FOUND'
    ) {
      throw new ProductError('FILE_NOT_FOUND', 'Product image not found', 404);
    }
    throw error;
  }
}
