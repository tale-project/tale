import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { bulkCreateContacts as bulkCreateContactsHelper } from './bulk_create_contacts';
import { deleteContact as deleteContactHelper } from './delete_contact';
import * as ContactsHelpers from './helpers';
import { updateContact as updateContactHelper } from './update_contact';
import {
  contactAddressValidator,
  contactSourceValidator,
  contactValidator,
} from './validators';

export const createContact = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: contactSourceValidator,
    locale: v.optional(v.string()),
    address: v.optional(contactAddressValidator),
    externalId: v.optional(v.union(v.string(), v.number())),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(jsonRecordValidator),
    notes: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    contactId: v.id('contacts'),
  }),
  handler: async (ctx, args) => {
    return await ContactsHelpers.createContact(ctx, args);
  },
});

export const findOrCreateContact = internalMutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    source: contactSourceValidator,
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.object({
    contactId: v.id('contacts'),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await ContactsHelpers.findOrCreateContact(ctx, args);
  },
});

export const updateContact = internalMutation({
  args: {
    contactId: v.id('contacts'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    externalId: v.optional(v.string()),
    source: v.optional(contactSourceValidator),
    locale: v.optional(v.string()),
    address: v.optional(contactAddressValidator),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(jsonRecordValidator),
    notes: v.optional(v.string()),
    /**
     * Caller's organizationId — closes the cross-tenant write IDOR on
     * REST `PATCH /api/v1/contacts/:id`. Optional for in-process
     * callers; REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.union(contactValidator, v.null()),
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const existing = await ctx.db.get(args.contactId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        return null;
      }
    }
    const { callerOrgId: _drop, ...rest } = args;
    return await updateContactHelper(ctx, rest);
  },
});

export const deleteContact = internalMutation({
  args: {
    contactId: v.id('contacts'),
    /**
     * Caller's organizationId — closes the cross-tenant DELETE IDOR
     * on REST `DELETE /api/v1/contacts/:id`. Optional for in-process
     * callers (e.g. retention cleanup); REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const existing = await ctx.db.get(args.contactId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        return null;
      }
    }
    return await deleteContactHelper(ctx, args.contactId);
  },
});

export const bulkCreateContacts = internalMutation({
  args: {
    organizationId: v.string(),
    contacts: v.array(
      v.object({
        name: v.optional(v.string()),
        email: v.string(),
        phone: v.optional(v.string()),
        externalId: v.optional(v.string()),
        source: contactSourceValidator,
        locale: v.optional(v.string()),
        address: v.optional(contactAddressValidator),
        tags: v.optional(v.array(v.string())),
        metadata: v.optional(jsonRecordValidator),
        notes: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    success: v.number(),
    failed: v.number(),
    errors: v.array(
      v.object({
        index: v.number(),
        error: v.string(),
        errorCode: v.string(),
        contact: v.any(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await bulkCreateContactsHelper(
      ctx,
      args.organizationId,
      args.contacts,
    );
  },
});

export const updateContacts = internalMutation({
  args: {
    contactId: v.optional(v.id('contacts')),
    organizationId: v.optional(v.string()),

    updates: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      source: v.optional(contactSourceValidator),
      locale: v.optional(v.string()),
      address: v.optional(contactAddressValidator),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('contacts')),
  }),
  handler: async (ctx, args) => {
    return await ContactsHelpers.updateContacts(ctx, args);
  },
});
