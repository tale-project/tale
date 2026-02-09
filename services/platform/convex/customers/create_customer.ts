/**
 * Create a new customer (business logic)
 */

import type { DataSource } from '../../lib/shared/schemas/common';
import type { MutationCtx } from '../_generated/server';

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
  const customerId = await ctx.db.insert('customers', {
    organizationId: args.organizationId,
    name: args.name,
    email: args.email,
    status: args.status,
    source: args.source,
    locale: args.locale,
    address: args.address,
    externalId: args.externalId,

    metadata: args.metadata as any,
  });

  await emitEvent(ctx, {
    organizationId: args.organizationId,
    eventType: 'customer.created',
    eventData: {
      customerId: customerId as string,
      name: args.name,
      email: args.email,
    },
  });

  return {
    success: true,
    customerId,
  };
}
