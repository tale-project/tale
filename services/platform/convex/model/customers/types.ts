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
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(customerStatusValidator),
  source: customerSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(customerAddressValidator),
  firstPurchaseAt: v.optional(v.number()),
  lastPurchaseAt: v.optional(v.number()),
  churned_at: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  totalSpent: v.optional(v.number()),
  orderCount: v.optional(v.number()),
  metadata: v.optional(v.any()),
  notes: v.optional(v.string()),
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
 * Customer statistics
 */
export interface CustomerStats {
  total: number;
  active: number;
  churned: number;
  potential: number;
  totalSpent: number;
  averageOrderValue: number;
}

/**
 * Bulk create result
 */
export interface BulkCreateResult {
  success: number;
  failed: number;
  errors: Array<{ index: number; error: string; customer: unknown }>;
}
