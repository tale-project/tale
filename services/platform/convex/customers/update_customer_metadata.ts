/**
 * Update customer metadata fields (business logic)
 *
 * This mutation safely updates nested metadata fields in a customer record.
 * It uses lodash for safe deep merging to avoid overwriting existing nested data.
 *
 * IMPORTANT: This function requires a valid customerId. It will throw an error
 * if the customer is not found, preventing accidental bulk updates.
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { set, merge } from 'lodash';

interface UpdateCustomerMetadataResult {
  success: boolean;
  customerId: Id<'customers'>;
}

export async function updateCustomerMetadata(
  ctx: MutationCtx,
  customerId: Id<'customers'>,
  metadataUpdates: Record<string, unknown>,
): Promise<UpdateCustomerMetadataResult> {
  // Get the existing customer
  const customer = await ctx.db.get(customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  // Get existing metadata or initialize empty object
  const existingMetadata = (customer.metadata as Record<string, unknown>) ?? {};

  // Process metadata updates
  // Support both flat keys and dot-notation keys
  const updatedMetadata: Record<string, unknown> = { ...existingMetadata };

  for (const [key, value] of Object.entries(metadataUpdates)) {
    if (key.includes('.')) {
      // Use lodash.set for dot-notation keys (e.g., "churn.survey.sent")
      set(updatedMetadata, key, value);
    } else {
      // For top-level keys, use merge to preserve nested objects
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof updatedMetadata[key] === 'object' &&
        updatedMetadata[key] !== null &&
        !Array.isArray(updatedMetadata[key])
      ) {
        // Deep merge objects
        updatedMetadata[key] = merge(
          {},
          updatedMetadata[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        // Direct assignment for primitives, arrays, or when replacing
        updatedMetadata[key] = value;
      }
    }
  }

  // Update the customer with the new metadata
  await ctx.db.patch(customerId, {
    metadata: updatedMetadata,
  });

  return {
    success: true,
    customerId,
  };
}

