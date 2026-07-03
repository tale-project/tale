/**
 * Find or create a customer by email (business logic)
 */

import type { DataSource } from '../../lib/shared/schemas/common';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createCustomer, type CreateCustomerArgs } from './create_customer';
import { getCustomerByEmail } from './get_customer_by_email';

export interface FindOrCreateCustomerArgs {
  organizationId: string;
  email: string;
  name?: string;
  source: DataSource;
  status?: 'active' | 'churned' | 'potential';
  metadata?: unknown;
}

export interface FindOrCreateCustomerResult {
  customerId: Id<'customers'>;
  created: boolean;
}

/**
 * Find a customer by email, or create a new one if not found.
 * This is useful for workflows that need to ensure a customer exists.
 */
export async function findOrCreateCustomer(
  ctx: MutationCtx,
  args: FindOrCreateCustomerArgs,
): Promise<FindOrCreateCustomerResult> {
  // Normalize to match how createCustomer stores/indexes email, so the
  // pre-check below sees the same row createCustomer would collide on and this
  // stays idempotent (returns the existing customer instead of throwing
  // CUSTOMER_DUPLICATE_EMAIL).
  const email = args.email.toLowerCase().trim();

  // Try to find existing customer
  const existingCustomer = await getCustomerByEmail(
    ctx,
    args.organizationId,
    email,
  );

  if (existingCustomer) {
    return {
      customerId: existingCustomer._id,
      created: false,
    };
  }

  // Create new customer
  const createArgs: CreateCustomerArgs = {
    organizationId: args.organizationId,
    email,
    name: args.name || email,
    source: args.source,
    status: args.status || 'potential',
    metadata: args.metadata,
  };

  const result = await createCustomer(ctx, createArgs);

  return {
    customerId: result.customerId,
    created: true,
  };
}
