/**
 * Create a new customer with validation (business logic for public API)
 */

import { ConvexError } from 'convex/values';

import type { DataSource } from '../../lib/shared/schemas/common';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';

interface CreateCustomerPublicArgs {
  organizationId: string;
  name?: string;
  email: string;
  externalId?: string;
  status: 'active' | 'churned' | 'potential';
  source: DataSource;
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
  const email = args.email.toLowerCase().trim();
  if (!email) {
    // Structured code so callers (REST + UI) get an actionable rejection
    // instead of a raw `Error` that Convex redacts to "Server Error" in prod.
    throw new ConvexError({ code: 'CUSTOMER_EMAIL_REQUIRED' });
  }

  // Check if customer with same email already exists
  if (email) {
    const existingCustomer = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', args.organizationId).eq('email', email),
      )
      .first();

    if (existingCustomer) {
      throw new ConvexError({ code: 'CUSTOMER_DUPLICATE_EMAIL', email });
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
      throw new ConvexError({
        code: 'CUSTOMER_DUPLICATE_EXTERNAL_ID',
        externalId: args.externalId,
      });
    }
  }

  return await ctx.db.insert('customers', {
    ...args,
    email,
    metadata: toConvexJsonRecord(args.metadata),
  });
}
