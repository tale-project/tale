/**
 * Create a new customer (business logic)
 */

import { ConvexError } from 'convex/values';

import type { DataSource } from '../../lib/shared/schemas/common';
import type { MutationCtx } from '../_generated/server';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { emitEvent } from '../workflows/triggers/emit_event';

export interface CreateCustomerArgs {
  organizationId: string;
  name?: string;
  email?: string;
  status?: 'active' | 'churned' | 'potential';
  source: DataSource;
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
  // Normalize email to match the dup-lookup index (and how bulk import stores
  // it). Email is optional here (agents may create a customer with only a name).
  const email = args.email?.toLowerCase().trim() || undefined;

  // Reject duplicate adds with a structured ConvexError instead of letting a
  // second row slip in (or — pre-#1993 — surfacing a raw `Error` that Convex
  // redacts to "Server Error" in prod). Callers match on `code`, not the
  // message string. Mirrors the `WEBSITE_DUPLICATE_DOMAIN` precedent.
  if (email) {
    const existing = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', args.organizationId).eq('email', email),
      )
      .first();

    if (existing) {
      throw new ConvexError({ code: 'CUSTOMER_DUPLICATE_EMAIL', email });
    }
  }

  if (args.externalId !== undefined) {
    const { externalId } = args;
    const existing = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_externalId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalId', externalId),
      )
      .first();

    if (existing) {
      throw new ConvexError({
        code: 'CUSTOMER_DUPLICATE_EXTERNAL_ID',
        externalId: String(externalId),
      });
    }
  }

  const customerId = await ctx.db.insert('customers', {
    organizationId: args.organizationId,
    name: args.name,
    email,
    status: args.status,
    source: args.source,
    locale: args.locale,
    address: args.address,
    externalId: args.externalId,

    metadata: toConvexJsonRecord(args.metadata),
  });

  const customer = await ctx.db.get(customerId);
  if (customer) {
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'customer.created',
      eventData: { customer },
    });
  }

  return {
    success: true,
    customerId,
  };
}
