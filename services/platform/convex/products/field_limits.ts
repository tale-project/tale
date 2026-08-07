/**
 * Server-side length caps for product string fields.
 *
 * Convex only enforces a 1 MB whole-document limit, so without these guards a
 * single mutation could persist megabyte-scale `name`/`description`/etc.
 * values. The limits are shared by every product write path (create, update,
 * bulk create, REST ingest, translation upsert) and mirrored client-side by
 * the create/edit dialog Zod schemas.
 */

import { ConvexError } from 'convex/values';

/** Maximum length of a product display name (characters). */
export const PRODUCT_NAME_MAX = 255;
/** Maximum length of a product description (characters). */
export const PRODUCT_DESCRIPTION_MAX = 4000;
/** Maximum length of a product category (characters). */
export const PRODUCT_CATEGORY_MAX = 100;
/** Maximum length of an ISO 4217 currency code (characters). */
export const PRODUCT_CURRENCY_MAX = 3;
/** Maximum length of a product image URL (characters). */
export const PRODUCT_IMAGE_URL_MAX = 2048;

interface ProductTranslationStringFields {
  name?: string;
  description?: string;
  category?: string;
}

interface ProductStringFields extends ProductTranslationStringFields {
  currency?: string;
  imageUrl?: string;
  translations?: Array<ProductTranslationStringFields | null | undefined>;
}

function assertMax(
  value: string | undefined | null,
  max: number,
  field: string,
): void {
  if (value != null && value.length > max) {
    throw new ConvexError({
      code: 'too_long',
      message: `Product ${field} exceeds ${max} characters (got ${value.length}).`,
      userMessage: `Product ${field} exceeds ${max} characters.`,
    });
  }
}

/**
 * Throw a `too_long` ConvexError if any provided product string field exceeds
 * its cap. Only validates fields that are present, so it is safe to call from
 * both create (all fields) and partial-update paths. Per-translation
 * `name`/`description`/`category` reuse the same base-field limits.
 */
export function validateProductFields(fields: ProductStringFields): void {
  assertMax(fields.name, PRODUCT_NAME_MAX, 'name');
  assertMax(fields.description, PRODUCT_DESCRIPTION_MAX, 'description');
  assertMax(fields.category, PRODUCT_CATEGORY_MAX, 'category');
  assertMax(fields.currency, PRODUCT_CURRENCY_MAX, 'currency');
  assertMax(fields.imageUrl, PRODUCT_IMAGE_URL_MAX, 'imageUrl');

  for (const translation of fields.translations ?? []) {
    if (!translation) continue;
    assertMax(translation.name, PRODUCT_NAME_MAX, 'translation name');
    assertMax(
      translation.description,
      PRODUCT_DESCRIPTION_MAX,
      'translation description',
    );
    assertMax(
      translation.category,
      PRODUCT_CATEGORY_MAX,
      'translation category',
    );
  }
}
