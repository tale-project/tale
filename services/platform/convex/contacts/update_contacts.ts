/**
 * Update contacts with flexible filtering and updates (business logic)
 *
 * This mutation allows updating contacts by:
 * - Contact ID (most common, safest)
 * - Organization filters (for batch updates)
 *
 * Updates support:
 * - Any contact field (name, email, phone, etc.)
 * - Metadata fields with dot notation
 * - Safe nested object merging using lodash
 *
 * SAFETY: At least one of contactId OR organizationId is required
 */

import merge from 'lodash/merge';
import set from 'lodash/set';

import { AppError } from '../../lib/shared/errors/app-error';
import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { UpdateContactsResult } from './types';

/**
 * Apply a partial metadata update onto an existing metadata record. Dot-notation
 * keys (`a.b.c`) are written via `lodash.set`; for top-level keys, two plain
 * objects are deep-merged while any other value (primitive / array / null)
 * replaces. Returns a fresh object — the inputs are never mutated.
 */
function mergeMetadataUpdates(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (key.includes('.')) {
      set(merged, key, value);
      continue;
    }
    const current = merged[key];
    merged[key] =
      isRecord(value) && isRecord(current) ? merge({}, current, value) : value;
  }
  return merged;
}

export interface UpdateContactsArgs {
  contactId?: Id<'contacts'>;
  organizationId?: string;

  updates: {
    name?: string;
    email?: string;
    phone?: string;
    source?: string;
    locale?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
    };
    tags?: string[];
    notes?: string;
    metadata?: Record<string, unknown>;
  };
}

export async function updateContacts(
  ctx: MutationCtx,
  args: UpdateContactsArgs,
): Promise<UpdateContactsResult> {
  // Validate: must provide either contactId or organizationId
  if (!args.contactId && !args.organizationId) {
    throw new AppError({
      code: 'MISSING_FILTER',
      message: 'Must provide either contactId or organizationId for safety',
    });
  }

  // Find contacts to update
  let contactsToUpdate: Array<Doc<'contacts'>> = [];

  if (args.contactId) {
    // Update by ID (most common case)
    const contact = await ctx.db.get(args.contactId);
    if (!contact) {
      throw new AppError({
        code: 'CONTACT_NOT_FOUND',
        message: `Contact not found: ${args.contactId}`,
      });
    }
    // Cross-tenant write guard: when the caller's org is known (the contact
    // workflow action passes it), the target contact must belong to it.
    // Closes the by-id IDOR; mirrors updateConversations.
    if (args.organizationId && contact.organizationId !== args.organizationId) {
      throw new AppError({
        code: 'CONTACT_NOT_FOUND',
        message: `Contact not found: ${args.contactId}`,
      });
    }
    contactsToUpdate = [contact];
  } else if (args.organizationId) {
    const orgId = args.organizationId;
    // Update by filters (batch update) using async iteration
    for await (const contact of ctx.db
      .query('contacts')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', orgId))) {
      contactsToUpdate.push(contact);
    }
  }

  // Build patches for each contact
  const patches: Array<{
    id: Id<'contacts'>;
    patch: Record<string, unknown>;
  }> = contactsToUpdate.map((contact) => {
    const patch: Record<string, unknown> = {};

    // Copy direct field updates
    if (args.updates.name !== undefined) patch.name = args.updates.name;
    if (args.updates.email !== undefined) patch.email = args.updates.email;
    if (args.updates.phone !== undefined) patch.phone = args.updates.phone;
    if (args.updates.source !== undefined) patch.source = args.updates.source;
    if (args.updates.locale !== undefined) patch.locale = args.updates.locale;
    if (args.updates.address !== undefined)
      patch.address = args.updates.address;
    if (args.updates.tags !== undefined) patch.tags = args.updates.tags;
    if (args.updates.notes !== undefined) patch.notes = args.updates.notes;

    if (args.updates.metadata) {
      // `contact.metadata` is untyped JSON — narrow before merging.
      const existingMetadata = isRecord(contact.metadata)
        ? contact.metadata
        : {};
      patch.metadata = mergeMetadataUpdates(
        existingMetadata,
        args.updates.metadata,
      );
    }

    return { id: contact._id, patch };
  });

  // Apply all patches in parallel
  await Promise.all(patches.map(({ id, patch }) => ctx.db.patch(id, patch)));

  const updatedIds = patches.map(({ id }) => id);

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds,
  };
}
