/**
 * Create a new contact (business logic)
 */

import { ConvexError } from 'convex/values';

import type { DataSource } from '../../lib/shared/schemas/common';
import type { MutationCtx } from '../_generated/server';
import { emitEvent } from '../events/emit';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';

export interface CreateContactArgs {
  organizationId: string;
  name?: string;
  email?: string;
  phone?: string;
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
  tags?: string[];
  metadata?: unknown;
  notes?: string;
}

export async function createContact(ctx: MutationCtx, args: CreateContactArgs) {
  // Normalize email to match the dup-lookup index (and how bulk import stores
  // it). Email is optional here (agents may create a contact with only a name).
  const email = args.email?.toLowerCase().trim() || undefined;

  // Reject duplicate adds with a structured ConvexError instead of letting a
  // second row slip in (or — pre-#1993 — surfacing a raw `Error` that Convex
  // redacts to "Server Error" in prod). Callers match on `code`, not the
  // message string. Mirrors the `WEBSITE_DUPLICATE_DOMAIN` precedent.
  if (email) {
    const existing = await ctx.db
      .query('contacts')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', args.organizationId).eq('email', email),
      )
      .first();

    if (existing) {
      throw new ConvexError({ code: 'CONTACT_DUPLICATE_EMAIL', email });
    }
  }

  if (args.externalId !== undefined) {
    const { externalId } = args;
    const existing = await ctx.db
      .query('contacts')
      .withIndex('by_organizationId_and_externalId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalId', externalId),
      )
      .first();

    if (existing) {
      throw new ConvexError({
        code: 'CONTACT_DUPLICATE_EXTERNAL_ID',
        externalId: String(externalId),
      });
    }
  }

  const contactId = await ctx.db.insert('contacts', {
    organizationId: args.organizationId,
    name: args.name,
    email,
    phone: args.phone,
    source: args.source,
    locale: args.locale,
    address: args.address,
    externalId: args.externalId,
    tags: args.tags,
    notes: args.notes,

    metadata: toConvexJsonRecord(args.metadata),
  });

  const contact = await ctx.db.get(contactId);
  if (contact) {
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'contact.created',
      eventData: { contact },
    });
  }

  return {
    success: true,
    contactId,
  };
}
