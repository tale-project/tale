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

import { ConvexError } from 'convex/values';
import merge from 'lodash/merge';
import set from 'lodash/set';

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { UpdateCustomersResult } from './types';

/**
 * Apply a partial metadata update onto an existing metadata record. Dot-notation
 * keys (`a.b.c`) are written via `lodash.set`; for top-level keys, two plain
 * objects are deep-merged while any other value (primitive / array / null)
 * replaces. Returns a fresh object — the inputs are never mutated.
 */
function mergeMetadataUpdates(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (key.includes('.')) {
      set(merged, key, value);
      continue;
    }
    const current = merged[key];
    merged[key] =
      isRecord(value) && isRecord(current) ? merge({}, current, value) : value;
  }
  return merged;
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
    throw new ConvexError({
      code: 'MISSING_FILTER',
      message: 'Must provide either customerId or organizationId for safety',
    });
  }

  // Find customers to update
  let customersToUpdate: Array<Doc<'customers'>> = [];

  if (args.customerId) {
    // Update by ID (most common case)
    const customer = await ctx.db.get(args.customerId);
    if (!customer) {
      throw new ConvexError({
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer not found: ${args.customerId}`,
      });
    }
    // Cross-tenant write guard: when the caller's org is known (the customer
    // workflow action passes it), the target customer must belong to it.
    // Closes the by-id IDOR; mirrors updateConversations.
    if (
      args.organizationId &&
      customer.organizationId !== args.organizationId
    ) {
      throw new ConvexError({
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer not found: ${args.customerId}`,
      });
    }
    customersToUpdate = [customer];
  } else if (args.organizationId) {
    const orgId = args.organizationId;
    // Update by filters (batch update) using async iteration
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', orgId))) {
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

    if (args.updates.metadata) {
      // `customer.metadata` is untyped JSON — narrow before merging.
      const existingMetadata = isRecord(customer.metadata)
        ? customer.metadata
        : {};
      patch.metadata = mergeMetadataUpdates(
        existingMetadata,
        args.updates.metadata,
      );
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
