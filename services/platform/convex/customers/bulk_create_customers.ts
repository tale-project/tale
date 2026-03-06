/**
 * Bulk create customers (business logic)
 */

import type { DataSource } from '../../lib/shared/schemas/common';
import type { MutationCtx } from '../_generated/server';
import type { BulkCreateResult } from './types';

import { toConvexJsonRecord } from '../lib/type_cast_helpers';

export interface BulkCreateCustomerData {
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

class BulkCreateError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message);
  }
}

export async function bulkCreateCustomers(
  ctx: MutationCtx,
  organizationId: string,
  customers: BulkCreateCustomerData[],
): Promise<BulkCreateResult> {
  const results: BulkCreateResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < customers.length; i++) {
    const customerData = customers[i];

    try {
      const email = customerData.email?.toLowerCase().trim() || undefined;

      // Check for duplicates
      if (email) {
        const existing = await ctx.db
          .query('customers')
          .withIndex('by_organizationId_and_email', (q) =>
            q.eq('organizationId', organizationId).eq('email', email),
          )
          .first();

        if (existing) {
          throw new BulkCreateError(
            `Customer with email ${email} already exists`,
            'duplicate_email',
          );
        }
      }

      if (customerData.externalId) {
        const { externalId } = customerData;
        const existing = await ctx.db
          .query('customers')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q.eq('organizationId', organizationId).eq('externalId', externalId),
          )
          .first();

        if (existing) {
          throw new BulkCreateError(
            `Customer with external ID ${customerData.externalId} already exists`,
            'duplicate_external_id',
          );
        }
      }

      await ctx.db.insert('customers', {
        organizationId,
        ...customerData,
        ...(email !== undefined && { email }),
        metadata: toConvexJsonRecord(customerData.metadata),
      });

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode:
          error instanceof BulkCreateError ? error.errorCode : 'unknown',
        customer: customerData,
      });
    }
  }

  return results;
}
