/**
 * Update an existing customer with validation (business logic for public API)
 */

import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { DataSource } from '../common/validators';

export interface UpdateCustomerArgs {
  customerId: Id<'customers'>;
  name?: string;
  email?: string;
  externalId?: string;
  status?: 'active' | 'churned' | 'potential';
  source?: DataSource;
  locale?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  metadata?: unknown;
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

  // Check for conflicts in parallel
  const checkEmailConflict =
    updateData.email && updateData.email !== existingCustomer.email;
  const checkExternalIdConflict =
    updateData.externalId && updateData.externalId !== existingCustomer.externalId;

  const [emailConflict, externalIdConflict] = await Promise.all([
    checkEmailConflict
      ? ctx.db
          .query('customers')
          .withIndex('by_organizationId_and_email', (q) =>
            q
              .eq('organizationId', existingCustomer.organizationId)
              .eq('email', updateData.email!),
          )
          .first()
      : Promise.resolve(null),
    checkExternalIdConflict
      ? ctx.db
          .query('customers')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q
              .eq('organizationId', existingCustomer.organizationId)
              .eq('externalId', updateData.externalId!),
          )
          .first()
      : Promise.resolve(null),
  ]);

  if (emailConflict && emailConflict._id !== customerId) {
    throw new Error(`Customer with email ${updateData.email} already exists`);
  }

  if (externalIdConflict && externalIdConflict._id !== customerId) {
    throw new Error(
      `Customer with external ID ${updateData.externalId} already exists`,
    );
  }

  // Remove undefined values
  const cleanUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([_, value]) => value !== undefined),
  );

  await ctx.db.patch(customerId, cleanUpdateData);
  return await ctx.db.get(customerId);
}
