import { z } from 'zod';

import { boundedJsonObject } from '../../../lib/shared/utils/json-bounds.ts';
import { isHttpUrl } from '../../../lib/utils/url.ts';
import {
  isIso4217Currency,
  PRODUCT_CATEGORY_MAX,
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
 *
 * Every free-text field is trimmed (`category` used to keep its padding
 * while `name` lost it), every optional field takes `null` to clear it,
 * `currency` is an ISO 4217 code stored uppercase, `imageUrl` an absolute
 * http(s) URL (a stored `javascript:` URL is a stored-XSS vector for any
 * surface that renders it), and `metadata` is a bounded free-form object.
 */

export const PRODUCT_TAG_MAX = 60;
export const PRODUCT_TAGS_MAX = 50;
export const PRODUCT_EXTERNAL_ID_MAX = 256;

const safeMagnitude = z
  .number()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const productNameSchema = z
  .string()
  .trim()
  .min(1, 'must not be blank')
  .max(PRODUCT_NAME_MAX);

/** An ISO 4217 code — any case in, uppercase out. */
export const productCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'must be a three-letter ISO 4217 currency code')
  .refine(isIso4217Currency, 'is not an ISO 4217 currency code');

export const productImageUrlSchema = z
  .string()
  .trim()
  .max(PRODUCT_IMAGE_URL_MAX)
  .refine(isHttpUrl, 'must be an absolute http(s) URL');

export const productFieldsShape = {
  name: productNameSchema.optional(),
  description: z
    .string()
    .trim()
    .max(PRODUCT_DESCRIPTION_MAX)
    .nullable()
    .optional(),
  imageUrl: productImageUrlSchema.nullable().optional(),
  stock: safeMagnitude.nullable().optional(),
  price: safeMagnitude.nullable().optional(),
  currency: productCurrencySchema.nullable().optional(),
  category: z.string().trim().max(PRODUCT_CATEGORY_MAX).nullable().optional(),
  tags: z
    .array(z.string().trim().max(PRODUCT_TAG_MAX))
    .max(PRODUCT_TAGS_MAX)
    .nullable()
    .optional(),
  status: z.enum(PRODUCT_STATUSES).nullable().optional(),
  externalId: z
    .string()
    .trim()
    .max(PRODUCT_EXTERNAL_ID_MAX)
    .nullable()
    .optional(),
  metadata: boundedJsonObject().nullable().optional(),
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
