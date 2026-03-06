/**
 * Convex validators for vendor operations
 */

import { v } from 'convex/values';

import { dataSourceValidator } from '../lib/validators/common';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../lib/validators/json';

export const vendorSourceValidator = dataSourceValidator;

export const vendorAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});

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
  errorCode: v.string(),
  vendor: jsonValueValidator,
});

export const bulkCreateVendorsResponseValidator = v.object({
  success: v.number(),
  failed: v.number(),
  errors: v.array(bulkCreateErrorItemValidator),
});
