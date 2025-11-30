/**
 * Update an existing customer with validation (business logic for public API)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';

export interface UpdateCustomerArgs {
  customerId: Id<'customers'>;
  name?: string;
  email?: string;
  phone?: string;
  externalId?: string;
  status?: 'active' | 'churned' | 'potential';
  source?: 'manual_import' | 'file_upload' | 'circuly';
  locale?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  firstPurchaseAt?: number;
  lastPurchaseAt?: number;
  churned_at?: number;
  tags?: string[];
  totalSpent?: number;
  orderCount?: number;
  metadata?: unknown;
  notes?: string;
}

export async function updateCustomer(
  ctx: MutationCtx,
  args: UpdateCustomerArgs,
): Promise<Doc<'customers'> | null> {
  const { customerId, ...updateData } = args;

  // Get the existing customer to check organization
  const existingCustomer = await ctx.db.get(customerId);
  if (!existingCustomer) {
    throw new Error('Customer not found');
  }

  // Check if email is being updated and doesn't conflict
  if (updateData.email && updateData.email !== existingCustomer.email) {
    const conflictingCustomer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_email', (q) =>
        q
          .eq('organizationId', existingCustomer.organizationId)
          .eq('email', updateData.email!),
      )
      .first();

    if (conflictingCustomer && conflictingCustomer._id !== customerId) {
      throw new Error(
        `Customer with email ${updateData.email} already exists`,
      );
    }
  }

  // Check if external ID is being updated and doesn't conflict
  if (
    updateData.externalId &&
    updateData.externalId !== existingCustomer.externalId
  ) {
    const conflictingCustomer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_externalId', (q) =>
        q
          .eq('organizationId', existingCustomer.organizationId)
          .eq('externalId', updateData.externalId!),
      )
      .first();

    if (conflictingCustomer && conflictingCustomer._id !== customerId) {
      throw new Error(
        `Customer with external ID ${updateData.externalId} already exists`,
      );
    }
  }

  // Remove undefined values
  const cleanUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([_, value]) => value !== undefined),
  );

  await ctx.db.patch(customerId, cleanUpdateData);
  return await ctx.db.get(customerId);
}

