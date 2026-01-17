/**
 * Convex validators for vendor operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  vendorSourceSchema,
  vendorAddressSchema,
} from '../../lib/shared/schemas/vendors';
import { jsonRecordValidator, jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  vendorSourceSchema,
  vendorAddressSchema,
  vendorItemSchema,
  vendorInputSchema,
  vendorListResponseSchema,
  bulkCreateVendorsResponseSchema,
} from '../../lib/shared/schemas/vendors';

// Simple schemas without z.lazy()
export const vendorSourceValidator = zodToConvex(vendorSourceSchema);
export const vendorAddressValidator = zodToConvex(vendorAddressSchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const vendorItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
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

export const vendorListResponseValidator = v.object({
  items: v.array(vendorItemValidator),
  total: v.number(),
  page: v.number(),
  pageSize: v.number(),
  totalPages: v.number(),
  hasNextPage: v.boolean(),
  hasPreviousPage: v.boolean(),
});

export const bulkCreateErrorItemValidator = v.object({
  index: v.number(),
  error: v.string(),
  vendor: jsonValueValidator,
});

export const bulkCreateVendorsResponseValidator = v.object({
  success: v.number(),
  failed: v.number(),
  errors: v.array(bulkCreateErrorItemValidator),
});
