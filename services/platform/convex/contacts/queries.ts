import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { queryWithRLS } from '../lib/rls';
import { listContactsPaginated as listContactsPaginatedHelper } from './list_contacts_paginated';
import { contactValidator } from './validators';

export const listContacts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(contactValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const contact of ctx.db
      .query('contacts')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(contact);
    }
    return results;
  },
});

export const approxCountContacts = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await countItemsInOrg(ctx.db, 'contacts', args.organizationId);
  },
});

export const listContactsPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    source: v.optional(v.string()),
    locale: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listContactsPaginatedHelper(ctx, args);
  },
});
