/**
 * Internal query to get a customer by email within an organization
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { getCustomerByEmail } from '../get_customer_by_email';

export const getCustomerByEmailInternal = internalQuery({
  args: {
    organizationId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await getCustomerByEmail(ctx, args.organizationId, args.email);
  },
});
