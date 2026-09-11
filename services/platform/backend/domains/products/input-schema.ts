import { z } from 'zod';

import {
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
} from '../../core/products/field_limits.ts';
import { PRODUCT_STATUSES } from './service.ts';

/**
 * The ONE shape of a product write, shared by the REST door and the app
 * door, capped at the exact limits `validateProductFields` enforces — so
 * a refusal names the field (`INVALID_BODY` + `data.issues`) instead of
 * the domain's blanket `PRODUCT_FIELDS_INVALID`. The REST door composes it
 * strict; the app door keeps the strip policy its adapters rely on.
 * `stock` and `price` are bounded to the IEEE-754 safe range: a magnitude
 * beyond it is rounded by `JSON.parse` before any schema sees it, and a
 * rounded stock count or price stored with a 201 is silent corruption.
 */

export const PRODUCT_TAG_MAX = 60;
export const PRODUCT_TAGS_MAX = 50;
export const PRODUCT_EXTERNAL_ID_MAX = 256;

const safeMagnitude = z
  .number()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const productNameSchema = z.string().min(1).max(PRODUCT_NAME_MAX);

export const productFieldsShape = {
  name: productNameSchema.optional(),
  description: z.string().max(PRODUCT_DESCRIPTION_MAX).optional(),
  imageUrl: z.string().max(PRODUCT_IMAGE_URL_MAX).optional(),
  stock: safeMagnitude.optional(),
  price: safeMagnitude.optional(),
  currency: z.string().max(PRODUCT_CURRENCY_MAX).optional(),
  category: z.string().max(PRODUCT_CATEGORY_MAX).optional(),
  tags: z
    .array(z.string().max(PRODUCT_TAG_MAX))
    .max(PRODUCT_TAGS_MAX)
    .optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  externalId: z.string().max(PRODUCT_EXTERNAL_ID_MAX).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

/** The REST door's shape: every field optional, unknown keys refused. */
export const productFieldsSchema = z.object(productFieldsShape).strict();

/** Create requires the name; update leaves every field optional. */
export const productCreateSchema = productFieldsSchema.extend({
  name: productNameSchema,
});

/** An update may carry the revision it was based on: a stale one answers
 * 409 `PRODUCT_STALE` without changing a field (the contacts precondition,
 * which a client carrying the pattern across used to find silently inert
 * here). */
export const productPatchSchema = productFieldsSchema.extend({
  expectedUpdatedAt: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
