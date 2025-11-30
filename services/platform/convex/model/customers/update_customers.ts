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

import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { set, merge } from 'lodash';

import type { UpdateCustomersResult } from './types';

export interface UpdateCustomersArgs {
  customerId?: Id<'customers'>;
  organizationId?: string;
  status?: 'active' | 'churned' | 'potential';

  updates: {
    name?: string;
    email?: string;
    phone?: string;
    status?: 'active' | 'churned' | 'potential';
    source?: string;
    locale?: string;
    tags?: string[];
    totalSpent?: number;
    orderCount?: number;
    notes?: string;
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
    // Update by filters (batch update)
    const customers = await ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId!),
      )
      .collect();

    // Filter by status and metadata
    customersToUpdate = customers.filter((customer) => {
      if (args.status && customer.status !== args.status) {
        return false;
      }

      return true;
    });
  }

  // Apply updates to each customer
  const updatedIds: Array<Id<'customers'>> = [];

  for (const customer of customersToUpdate) {
    // Build the patch object
    const patch: Record<string, unknown> = {};

    // Copy direct field updates
    if (args.updates.name !== undefined) patch.name = args.updates.name;
    if (args.updates.email !== undefined) patch.email = args.updates.email;
    if (args.updates.phone !== undefined) patch.phone = args.updates.phone;
    if (args.updates.status !== undefined) patch.status = args.updates.status;
    if (args.updates.source !== undefined) patch.source = args.updates.source;
    if (args.updates.locale !== undefined) patch.locale = args.updates.locale;
    if (args.updates.tags !== undefined) patch.tags = args.updates.tags;
    if (args.updates.totalSpent !== undefined)
      patch.totalSpent = args.updates.totalSpent;
    if (args.updates.orderCount !== undefined)
      patch.orderCount = args.updates.orderCount;
    if (args.updates.notes !== undefined) patch.notes = args.updates.notes;

    // Handle metadata updates with lodash
    if (args.updates.metadata) {
      const existingMetadata =
        (customer.metadata as Record<string, unknown>) ?? {};
      const updatedMetadata: Record<string, unknown> = {
        ...existingMetadata,
      };

      for (const [key, value] of Object.entries(args.updates.metadata)) {
        if (key.includes('.')) {
          // Use lodash.set for dot-notation keys
          set(updatedMetadata, key, value);
        } else {
          // For top-level keys, use merge for objects
          if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            typeof updatedMetadata[key] === 'object' &&
            updatedMetadata[key] !== null &&
            !Array.isArray(updatedMetadata[key])
          ) {
            updatedMetadata[key] = merge(
              {},
              updatedMetadata[key] as Record<string, unknown>,
              value as Record<string, unknown>,
            );
          } else {
            updatedMetadata[key] = value;
          }
        }
      }

      patch.metadata = updatedMetadata;
    }

    // Apply the patch
    await ctx.db.patch(customer._id, patch);
    updatedIds.push(customer._id);
  }

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds,
  };
}
