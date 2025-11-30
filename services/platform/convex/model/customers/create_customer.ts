/**
 * Create a new customer (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { CreateCustomerResult } from './types';

export interface CreateCustomerArgs {
  organizationId: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: 'active' | 'churned' | 'potential';
  source?: 'manual_import' | 'file_upload' | 'circuly';
  locale?: string;
  tags?: string[];
  totalSpent?: number;
  orderCount?: number;
  notes?: string;
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
    phone: args.phone,
    status: args.status,
    source: args.source ?? 'manual_import',
    locale: args.locale,
    tags: args.tags,
    totalSpent: args.totalSpent,
    orderCount: args.orderCount,
    notes: args.notes,
    externalId: args.externalId,
    metadata: args.metadata,
  });

  return {
    success: true,
    customerId,
  };
}
