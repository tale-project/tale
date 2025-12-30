/**
 * Create a new customer (business logic)
 */

import type { MutationCtx } from '../../_generated/server';

export interface CreateCustomerArgs {
  organizationId: string;
  name?: string;
  email?: string;
  status?: 'active' | 'churned' | 'potential';
  source: 'manual_import' | 'file_upload' | 'circuly';
  locale?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  externalId?: string | number;
  metadata?: unknown;
}

export async function createCustomer(
  ctx: MutationCtx,
  args: CreateCustomerArgs,
) {
  const customerId = await ctx.db.insert('customers', {
    organizationId: args.organizationId,
    name: args.name,
    email: args.email,
    status: args.status,
    source: args.source,
    locale: args.locale,
    address: args.address,
    externalId: args.externalId,
    metadata: args.metadata,
  });

  return {
    success: true,
    customerId,
  };
}
