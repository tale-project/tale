/**
 * Type definitions for customer operations
 */

import type { Infer } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import {
  customerAddressValidator,
  customerSourceValidator,
  customerStatusValidator,
  customerValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type CustomerStatus = Infer<typeof customerStatusValidator>;
export type CustomerSource = Infer<typeof customerSourceValidator>;
type CustomerAddress = Infer<typeof customerAddressValidator>;
export type Customer = Infer<typeof customerValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

/**
 * Result from creating a customer
 */
interface CreateCustomerResult {
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
