/**
 * Bulk create contacts (business logic)
 */

import type { DataSource } from '../../lib/shared/schemas/common';
import type { MutationCtx } from '../_generated/server';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import type { BulkCreateResult } from './types';

export interface BulkCreateContactData {
  name?: string;
  email: string;
  phone?: string;
  externalId?: string;
  source: DataSource;
  locale?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  tags?: string[];
  metadata?: unknown;
  notes?: string;
}

class BulkCreateError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message);
  }
}

export async function bulkCreateContacts(
  ctx: MutationCtx,
  organizationId: string,
  contacts: BulkCreateContactData[],
): Promise<BulkCreateResult> {
  const results: BulkCreateResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < contacts.length; i++) {
    const contactData = contacts[i];

    try {
      const email = contactData.email?.toLowerCase().trim() || undefined;

      // Check for duplicates
      if (email) {
        const existing = await ctx.db
          .query('contacts')
          .withIndex('by_organizationId_and_email', (q) =>
            q.eq('organizationId', organizationId).eq('email', email),
          )
          .first();

        if (existing) {
          throw new BulkCreateError(
            `Contact with email ${email} already exists`,
            'duplicate_email',
          );
        }
      }

      if (contactData.externalId) {
        const { externalId } = contactData;
        const existing = await ctx.db
          .query('contacts')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q.eq('organizationId', organizationId).eq('externalId', externalId),
          )
          .first();

        if (existing) {
          throw new BulkCreateError(
            `Contact with external ID ${contactData.externalId} already exists`,
            'duplicate_external_id',
          );
        }
      }

      await ctx.db.insert('contacts', {
        organizationId,
        ...contactData,
        ...(email !== undefined && { email }),
        metadata: toConvexJsonRecord(contactData.metadata),
      });

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode:
          error instanceof BulkCreateError ? error.errorCode : 'unknown',
        contact: contactData,
      });
    }
  }

  return results;
}
