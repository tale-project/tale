/**
 * Convex validators for vendors model
 */

import { v } from 'convex/values';

/**
 * Sort order validator
 */
export const sortOrderValidator = v.union(v.literal('asc'), v.literal('desc'));

/**
 * Vendor source validator
 */
export const vendorSourceValidator = v.union(
  v.literal('manual_import'),
  v.literal('file_upload'),
  v.literal('circuly'),
);

/**
 * Vendor address validator
 */
export const vendorAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});

/**
 * Vendor input validator (for creating/updating vendors)
 */
export const vendorInputValidator = v.object({
  name: v.optional(v.string()),
  email: v.string(),
  phone: v.optional(v.string()),
  externalId: v.optional(v.string()),
  source: vendorSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(vendorAddressValidator),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(v.any()),
  notes: v.optional(v.string()),
});

/**
 * Vendor update validator (for updating existing vendors)
 */
export const vendorUpdateValidator = v.object({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  externalId: v.optional(v.string()),
  source: v.optional(vendorSourceValidator),
  locale: v.optional(v.string()),
  address: v.optional(vendorAddressValidator),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(v.any()),
  notes: v.optional(v.string()),
});

/**
 * Vendor list response validator (paginated list with metadata)
 */
export const vendorListResponseValidator = v.object({
  items: v.array(v.any()),
  total: v.number(),
  page: v.number(),
  pageSize: v.number(),
  totalPages: v.number(),
  hasNextPage: v.boolean(),
  hasPreviousPage: v.boolean(),
});

/**
 * Bulk create error item validator
 */
export const bulkCreateErrorItemValidator = v.object({
  index: v.number(),
  error: v.string(),
  vendor: v.any(),
});

/**
 * Bulk create vendors response validator
 */
export const bulkCreateVendorsResponseValidator = v.object({
  success: v.number(),
  failed: v.number(),
  errors: v.array(bulkCreateErrorItemValidator),
});
