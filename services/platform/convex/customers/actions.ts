import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { api } from '../_generated/api';
import { action } from '../_generated/server';
import {
  customerAddressValidator,
  customerSourceValidator,
  customerStatusValidator,
} from './validators';

export const bulkCreateCustomers = action({
  args: {
    organizationId: v.string(),
    customers: v.array(
      v.object({
        name: v.optional(v.string()),
        email: v.string(),
        externalId: v.optional(v.string()),
        status: customerStatusValidator,
        source: customerSourceValidator,
        locale: v.optional(v.string()),
        address: v.optional(customerAddressValidator),
        metadata: v.optional(jsonRecordValidator),
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
        customer: v.any(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.customers.mutations.bulkCreateCustomers,
      args,
    );
  },
});
