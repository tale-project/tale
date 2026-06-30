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
    throw new ConvexError({
      code: 'EMAIL_REQUIRED',
      message: 'Email is required',
    });
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
      throw new ConvexError({
        code: 'DUPLICATE_EMAIL',
        message: `Customer with email ${email} already exists`,
      });
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
        code: 'DUPLICATE_EXTERNAL_ID',
        message: `Customer with external ID ${args.externalId} already exists`,
      });
    }
  }

  return await ctx.db.insert('customers', {
    ...args,
    email,
    metadata: toConvexJsonRecord(args.metadata),
  });
}
