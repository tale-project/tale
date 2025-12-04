/**
 * Create a new customer with validation (business logic for public API)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export interface CreateCustomerPublicArgs {
  organizationId: string;
  name?: string;
  email: string;
  externalId?: string;
  status: 'active' | 'churned' | 'potential';
  source: 'manual_import' | 'file_upload' | 'circuly';
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

export async function createCustomerPublic(
  ctx: MutationCtx,
  args: CreateCustomerPublicArgs,
): Promise<Id<'customers'>> {
  // Check if customer with same email already exists
  if (args.email) {
    const existingCustomer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', args.organizationId).eq('email', args.email),
      )
      .first();

    if (existingCustomer) {
      throw new Error(`Customer with email ${args.email} already exists`);
    }
  }

  // Check if customer with same external ID already exists
  if (args.externalId) {
    const existingCustomer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_externalId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalId', args.externalId),
      )
      .first();

    if (existingCustomer) {
      throw new Error(
        `Customer with external ID ${args.externalId} already exists`,
      );
    }
  }

  return await ctx.db.insert('customers', args);
}
