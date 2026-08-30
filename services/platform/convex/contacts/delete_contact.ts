/**
 * Delete a contact (business logic)
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitEvent } from '../events/emit';
import { assertNotHeld } from '../governance/legal_hold_guard';

export async function deleteContact(
  ctx: MutationCtx,
  contactId: Id<'contacts'>,
): Promise<null> {
  const contact = await ctx.db.get(contactId);
  if (!contact) {
    throw new AppError({
      code: 'CONTACT_NOT_FOUND',
      message: 'Contact not found',
    });
  }

  // Contacts have no per-row hold today; this only blocks on org-level
  // "nuclear halt" holds (round-2 v08 B4).
  await assertNotHeld(
    ctx,
    contact.organizationId,
    'contact',
    String(contactId),
  );

  await emitEvent(ctx, {
    organizationId: contact.organizationId,
    eventType: 'contact.deleted',
    eventData: { contact },
  });

  await ctx.db.delete(contactId);
  return null;
}
