/**
 * Type definitions and validators for customer operations
 */

import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Customer status validator
 */
export const customerStatusValidator = v.union(
  v.literal('active'),
  v.literal('churned'),
  v.literal('potential'),
);

/**
 * Customer source validator
 */
export const customerSourceValidator = v.union(
  v.literal('manual_import'),
  v.literal('file_upload'),
  v.literal('circuly'),
);

/**
 * Customer address validator
 */
export const customerAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});

/**
 * Customer document validator (matches schema)
 */
export const customerValidator = v.object({
  _id: v.id('customers'),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(customerStatusValidator),
  source: customerSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(customerAddressValidator),
  metadata: v.optional(v.any()),
});

// =============================================================================
// TYPESCRIPT TYPES
// =============================================================================

/**
 * Result from creating a customer
 */
export interface CreateCustomerResult {
  success: boolean;
  customerId: Id<'customers'>;
}

/**
 * Result from updating customers
 */
export interface UpdateCustomersResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'customers'>[];
}

/**
 * Bulk create result
 */
export interface BulkCreateResult {
  success: number;
  failed: number;
  errors: Array<{ index: number; error: string; customer: unknown }>;
}
