// Note: jsonRecordSchema contains z.lazy() which zodToConvex doesn't support,
// so validators containing metadata use native Convex v instead.

import { v } from 'convex/values';

import { SUPPORTED_LOCALES } from '../../lib/shared/constants/locales';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../lib/validators/json';

export const productStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('draft'),
  v.literal('archived'),
);

/**
 * Whitelist validator for translation locales — rejects anything outside the
 * platform's supported locale set at the Convex argument boundary.
 */
export const productLocaleValidator = v.union(
  ...SUPPORTED_LOCALES.map((locale) => v.literal(locale)),
);

const translationSharedFields = {
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  createdAt: v.optional(v.number()),
  lastUpdated: v.number(),
};

/**
 * Read/storage shape for a persisted translation. `language` stays `v.string()`
 * so reads of pre-existing documents (which may hold legacy, pre-whitelist
 * locale codes) never fail return validation. Writes go through
 * {@link productTranslationInputValidator}, which enforces the whitelist.
 */
export const productTranslationValidator = v.object({
  language: v.string(),
  ...translationSharedFields,
});

/**
 * Write shape for an incoming translation — identical to
 * {@link productTranslationValidator} but with `language` constrained to the
 * supported locale whitelist.
 */
export const productTranslationInputValidator = v.object({
  language: productLocaleValidator,
  ...translationSharedFields,
});

export const productItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  lastUpdated: v.number(),
  createdAt: v.number(),
  relatedProductsCount: v.optional(v.number()),
  translations: v.optional(v.array(productTranslationValidator)),
  metadata: v.optional(jsonRecordValidator),
});

export const productDocValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  translations: v.optional(v.array(productTranslationValidator)),
  lastUpdated: v.optional(v.number()),
  externalId: v.optional(v.union(v.string(), v.number())),
  metadata: v.optional(jsonRecordValidator),
});

export const createProductArgsValidator = v.object({
  organizationId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  externalId: v.optional(v.union(v.string(), v.number())),
  metadata: v.optional(jsonRecordValidator),
});

export const updateProductArgsValidator = v.object({
  productId: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(productStatusValidator),
  translations: v.optional(v.array(productTranslationInputValidator)),
  metadata: v.optional(jsonRecordValidator),
});

export const bulkCreateErrorItemValidator = v.object({
  index: v.number(),
  error: v.string(),
  errorCode: v.string(),
  product: jsonValueValidator,
});

export const bulkCreateProductsResponseValidator = v.object({
  success: v.number(),
  failed: v.number(),
  errors: v.array(bulkCreateErrorItemValidator),
});
