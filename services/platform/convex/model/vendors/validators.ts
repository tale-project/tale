/**
 * Convex validators for vendors model
 */

import { v } from 'convex/values';
import { jsonRecordValidator, jsonValueValidator } from '../../../lib/shared/validators/utils/json-value';

import { dataSourceValidator } from '../common/validators';

export * from '../common/validators';

/**
 * Vendor source validator (alias for dataSourceValidator)
 */
export const vendorSourceValidator = dataSourceValidator;

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
 * Vendor item validator (matches Doc<'vendors'> shape)
 * Used for vendor list responses and single vendor queries
 */
export const vendorItemValidator = v.object({
  // Convex system fields
  _id: v.id('vendors'),
  _creationTime: v.number(),
  // User-defined fields
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  source: vendorSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(vendorAddressValidator),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  notes: v.optional(v.string()),
});

/**
 * Vendor input validator (for creating/updating vendors)
 */
export const vendorInputValidator = v.object({
  name: v.optional(v.string()),
  email: v.string(),
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  source: vendorSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(vendorAddressValidator),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  notes: v.optional(v.string()),
});

/**
 * Vendor list response validator (paginated list with metadata)
 */
export const vendorListResponseValidator = v.object({
  items: v.array(vendorItemValidator),
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
  vendor: jsonValueValidator,
});

/**
 * Bulk create vendors response validator
 */
export const bulkCreateVendorsResponseValidator = v.object({
  success: v.number(),
  failed: v.number(),
  errors: v.array(bulkCreateErrorItemValidator),
});
