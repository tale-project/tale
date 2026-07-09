/**
 * Type definitions for contact operations
 */

import type { Infer } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type {
  contactAddressValidator,
  contactSourceValidator,
  contactValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type ContactSource = Infer<typeof contactSourceValidator>;
export type ContactAddress = Infer<typeof contactAddressValidator>;
export type Contact = Infer<typeof contactValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

/**
 * Result from creating a contact
 */
export interface CreateContactResult {
  success: boolean;
  contactId: Id<'contacts'>;
}

/**
 * Result from updating contacts
 */
export interface UpdateContactsResult {
  success: boolean;
  updatedCount: number;
  updatedIds: Id<'contacts'>[];
}

/**
 * Bulk create result
 */
export interface BulkCreateResult {
  success: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    errorCode: string;
    contact: unknown;
  }>;
}
