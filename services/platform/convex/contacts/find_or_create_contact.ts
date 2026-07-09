/**
 * Find or create a contact by email (business logic)
 */

import type { DataSource } from '../../lib/shared/schemas/common';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createContact, type CreateContactArgs } from './create_contact';
import { getContactByEmail } from './get_contact_by_email';

export interface FindOrCreateContactArgs {
  organizationId: string;
  email: string;
  name?: string;
  source: DataSource;
  metadata?: unknown;
}

export interface FindOrCreateContactResult {
  contactId: Id<'contacts'>;
  created: boolean;
}

/**
 * Find a contact by email, or create a new one if not found.
 * This is useful for workflows that need to ensure a contact exists.
 */
export async function findOrCreateContact(
  ctx: MutationCtx,
  args: FindOrCreateContactArgs,
): Promise<FindOrCreateContactResult> {
  // Normalize to match how createContact stores/indexes email, so the
  // pre-check below sees the same row createContact would collide on and this
  // stays idempotent (returns the existing contact instead of throwing
  // CONTACT_DUPLICATE_EMAIL).
  const email = args.email.toLowerCase().trim();

  // Try to find existing contact
  const existingContact = await getContactByEmail(
    ctx,
    args.organizationId,
    email,
  );

  if (existingContact) {
    return {
      contactId: existingContact._id,
      created: false,
    };
  }

  // Create new contact
  const createArgs: CreateContactArgs = {
    organizationId: args.organizationId,
    email,
    name: args.name || email,
    source: args.source,
    metadata: args.metadata,
  };

  const result = await createContact(ctx, createArgs);

  return {
    contactId: result.contactId,
    created: true,
  };
}
