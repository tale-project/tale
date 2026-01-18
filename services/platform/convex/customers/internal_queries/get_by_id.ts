/**
 * Internal query to get a customer by ID
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { getCustomerById } from '../get_customer_by_id';

export const getCustomerById_internal = internalQuery({
  args: {
    customerId: v.id('customers'),
  },
  handler: async (ctx, args) => {
    return await getCustomerById(ctx, args.customerId);
  },
});
