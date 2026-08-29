import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { getContactByEmail as getContactByEmailHelper } from './get_contact_by_email';
import * as ContactsHelpers from './helpers';
import { contactSourceValidator, contactValidator } from './validators';

export const getContactByEmail = internalQuery({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await getContactByEmailHelper(ctx, args.organizationId, args.email);
  },
});

export const getContactById = internalQuery({
  args: {
    contactId: v.id('contacts'),
    /**
     * Caller's organizationId. When provided, the query refuses to
     * return a contact whose `organizationId` does not match —
     * closing the cross-org IDOR on REST `GET /api/v1/contacts/:id`.
     * Optional for in-process callers (workflows, agent tools) that
     * already operate within a single org's trust boundary; REST
     * handlers MUST pass this. Returns `null` (not an error) on
     * mismatch so the REST layer surfaces 404 without leaking
     * contact existence across tenants.
     */
    callerOrgId: v.optional(v.string()),
  },
  returns: v.union(contactValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await ContactsHelpers.getContactById(ctx, args.contactId);
    if (!row) return null;
    if (
      args.callerOrgId !== undefined &&
      row.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return row;
  },
});

export const queryContacts = internalQuery({
  args: {
    organizationId: v.string(),
    externalId: v.optional(v.union(v.string(), v.number())),
    source: v.optional(
      v.union(contactSourceValidator, v.array(contactSourceValidator)),
    ),
    locale: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
    /** Match individual words of `searchTerm` as well as the whole phrase.
     *  The chat leg passes a question, so the phrase alone matches nothing. */
    matchWords: v.optional(v.boolean()),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(contactValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ContactsHelpers.queryContacts(ctx, args);
  },
});

export const filterContacts = internalQuery({
  args: {
    organizationId: v.string(),
    expression: v.string(),
  },
  returns: v.object({
    contacts: v.array(contactValidator),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ContactsHelpers.filterContacts(ctx, args);
  },
});
