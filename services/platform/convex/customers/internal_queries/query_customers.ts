/**
 * Internal query to query customers with filtering and pagination
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { queryCustomers } from '../query_customers';
import { customerStatusValidator, customerSourceValidator } from '../validators';

export const queryCustomersInternal = internalQuery({
  args: {
    organizationId: v.string(),
    externalId: v.optional(v.union(v.string(), v.number())),
    status: v.optional(v.union(customerStatusValidator, v.array(customerStatusValidator))),
    source: v.optional(v.union(customerSourceValidator, v.array(v.string()))),
    locale: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await queryCustomers(ctx, args);
  },
});
