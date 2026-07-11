import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { mutationWithRLS } from '../lib/rls';
import * as ContactsHelpers from './helpers';
import {
  contactAddressValidator,
  contactSourceValidator,
  contactValidator,
} from './validators';

export const createContact = mutationWithRLS({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: contactSourceValidator,
    locale: v.optional(v.string()),
    address: v.optional(contactAddressValidator),
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

export const updateContact = mutationWithRLS({
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
  },
  returns: v.union(contactValidator, v.null()),
  handler: async (ctx, args) => {
    return await ContactsHelpers.updateContact(ctx, args);
  },
});

export const deleteContact = mutationWithRLS({
  args: {
    contactId: v.id('contacts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ContactsHelpers.deleteContact(ctx, args.contactId);
  },
});

export const bulkCreateContacts = mutationWithRLS({
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
    return await ContactsHelpers.bulkCreateContacts(
      ctx,
      args.organizationId,
      args.contacts,
    );
  },
});
