/**
 * Update customers with flexible filtering and updates (business logic)
 *
 * This mutation allows updating customers by:
 * - Customer ID (most common, safest)
 * - Organization + Status + Metadata filters (for batch updates)
 *
 * Updates support:
 * - Any customer field (name, email, status, etc.)
 * - Metadata fields with dot notation
 * - Safe nested object merging using lodash
 *
 * SAFETY: At least one of customerId OR (organizationId + additional filter) is required
 */

import { set, merge } from 'lodash';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { UpdateCustomersResult } from './types';

/**
 * Type guard to check if a value is a plain record object.
 * Returns false for null, arrays, and non-objects.
 */
function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export interface UpdateCustomersArgs {
  customerId?: Id<'customers'>;
  organizationId?: string;
  status?: 'active' | 'churned' | 'potential';

  updates: {
    name?: string;
    email?: string;
    status?: 'active' | 'churned' | 'potential';
    source?: string;
    locale?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
    };
    metadata?: Record<string, unknown>;
  };
}

export async function updateCustomers(
  ctx: MutationCtx,
  args: UpdateCustomersArgs,
): Promise<UpdateCustomersResult> {
  // Validate: must provide either customerId or organizationId
  if (!args.customerId && !args.organizationId) {
    throw new Error(
      'Must provide either customerId or organizationId for safety',
    );
  }

  // Find customers to update
  let customersToUpdate: Array<Doc<'customers'>> = [];

  if (args.customerId) {
    // Update by ID (most common case)
    const customer = await ctx.db.get(args.customerId);
    if (!customer) {
      throw new Error(`Customer not found: ${args.customerId}`);
    }
    customersToUpdate = [customer];
  } else if (args.organizationId) {
    // Update by filters (batch update) using async iteration
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      // Filter by status
      if (args.status && customer.status !== args.status) {
        continue;
      }
      customersToUpdate.push(customer);
    }
  }

  // Build patches for each customer
  const patches: Array<{
    id: Id<'customers'>;
    patch: Record<string, unknown>;
  }> = customersToUpdate.map((customer) => {
    const patch: Record<string, unknown> = {};

    // Copy direct field updates
    if (args.updates.name !== undefined) patch.name = args.updates.name;
    if (args.updates.email !== undefined) patch.email = args.updates.email;
    if (args.updates.status !== undefined) patch.status = args.updates.status;
    if (args.updates.source !== undefined) patch.source = args.updates.source;
    if (args.updates.locale !== undefined) patch.locale = args.updates.locale;
    if (args.updates.address !== undefined)
      patch.address = args.updates.address;

    // Handle metadata updates with lodash
    if (args.updates.metadata) {
      // Use type guard to safely access existing metadata
      const existingMetadata = isPlainRecord(customer.metadata)
        ? customer.metadata
        : {};
      const updatedMetadata: Record<string, unknown> = {
        ...existingMetadata,
      };

      for (const [key, value] of Object.entries(args.updates.metadata)) {
        if (key.includes('.')) {
          // Use lodash.set for dot-notation keys
          set(updatedMetadata, key, value);
        } else {
          // For top-level keys, use merge for objects if both are plain records
          const existingValue = updatedMetadata[key];

          if (isPlainRecord(value) && isPlainRecord(existingValue)) {
            updatedMetadata[key] = merge({}, existingValue, value);
          } else {
            updatedMetadata[key] = value;
          }
        }
      }

      patch.metadata = updatedMetadata;
    }

    return { id: customer._id, patch };
  });

  // Apply all patches in parallel
  await Promise.all(patches.map(({ id, patch }) => ctx.db.patch(id, patch)));

  const updatedIds = patches.map(({ id }) => id);

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds,
  };
}
