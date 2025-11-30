/**
 * Find or create a customer by email (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { getCustomerByEmail } from './get_customer_by_email';
import { createCustomer, type CreateCustomerArgs } from './create_customer';

export interface FindOrCreateCustomerArgs {
  organizationId: string;
  email: string;
  name?: string;
  source?: 'manual_import' | 'file_upload' | 'circuly';
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
  // Try to find existing customer
  const existingCustomer = await getCustomerByEmail(
    ctx,
    args.organizationId,
    args.email,
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
    email: args.email,
    name: args.name || args.email,
    source: args.source || 'manual_import',
    status: args.status || 'potential',
    metadata: args.metadata,
  };

  const result = await createCustomer(ctx, createArgs);

  return {
    customerId: result.customerId,
    created: true,
  };
}
