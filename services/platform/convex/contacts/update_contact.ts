/**
 * Update an existing contact with validation (business logic for public API)
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { DataSource } from '../../lib/shared/schemas/common';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitEvent } from '../events/emit';

export interface UpdateContactArgs {
  contactId: Id<'contacts'>;
  name?: string;
  email?: string;
  phone?: string;
  externalId?: string;
  source?: DataSource;
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

export async function updateContact(
  ctx: MutationCtx,
  args: UpdateContactArgs,
): Promise<Doc<'contacts'> | null> {
  const { contactId, ...updateData } = args;

  if (updateData.email) {
    const normalized = updateData.email.toLowerCase().trim();
    updateData.email = normalized || undefined;
  }

  // Get the existing contact to check organization
  const existingContact = await ctx.db.get(contactId);
  if (!existingContact) {
    throw new AppError({
      code: 'CONTACT_NOT_FOUND',
      message: 'Contact not found',
    });
  }

  // Check for conflicts in parallel
  const checkEmailConflict =
    updateData.email && updateData.email !== existingContact.email;
  const checkExternalIdConflict =
    updateData.externalId &&
    updateData.externalId !== existingContact.externalId;

  const [emailConflict, externalIdConflict] = await Promise.all([
    checkEmailConflict && updateData.email
      ? ctx.db
          .query('contacts')
          .withIndex('by_organizationId_and_email', (q) =>
            q
              .eq('organizationId', existingContact.organizationId)
              .eq('email', updateData.email),
          )
          .first()
      : Promise.resolve(null),
    checkExternalIdConflict && updateData.externalId
      ? ctx.db
          .query('contacts')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q
              .eq('organizationId', existingContact.organizationId)
              .eq('externalId', updateData.externalId),
          )
          .first()
      : Promise.resolve(null),
  ]);

  if (emailConflict && emailConflict._id !== contactId) {
    throw new AppError({
      code: 'DUPLICATE_EMAIL',
      message: `Contact with email ${updateData.email} already exists`,
    });
  }

  if (externalIdConflict && externalIdConflict._id !== contactId) {
    throw new AppError({
      code: 'DUPLICATE_EXTERNAL_ID',
      message: `Contact with external ID ${updateData.externalId} already exists`,
    });
  }

  // Remove undefined values
  const cleanUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([_, value]) => value !== undefined),
  );

  await ctx.db.patch(contactId, cleanUpdateData);

  const updatedContact = await ctx.db.get(contactId);

  if (updatedContact) {
    await emitEvent(ctx, {
      organizationId: existingContact.organizationId,
      eventType: 'contact.updated',
      eventData: { contact: updatedContact },
    });
  }

  return updatedContact;
}
