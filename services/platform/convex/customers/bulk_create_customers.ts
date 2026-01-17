/**
 * Bulk create customers (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { BulkCreateResult } from './types';
import type { DataSource } from '../common/validators';

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
      // Check for duplicates
      if (customerData.email) {
        const existing = await ctx.db
          .query('customers')
          .withIndex('by_organizationId_and_email', (q) =>
            q
              .eq('organizationId', organizationId)
              .eq('email', customerData.email!),
          )
          .first();

        if (existing) {
          throw new Error(
            `Customer with email ${customerData.email} already exists`,
          );
        }
      }

      if (customerData.externalId) {
        const existing = await ctx.db
          .query('customers')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q
              .eq('organizationId', organizationId)
              .eq('externalId', customerData.externalId!),
          )
          .first();

        if (existing) {
          throw new Error(
            `Customer with external ID ${customerData.externalId} already exists`,
          );
        }
      }

      await ctx.db.insert('customers', {
        organizationId,
        ...customerData,
      });

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
        customer: customerData,
      });
    }
  }

  return results;
}
