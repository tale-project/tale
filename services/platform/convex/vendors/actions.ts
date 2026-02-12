import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import {
  vendorInputValidator,
  bulkCreateVendorsResponseValidator,
} from './validators';

export const bulkCreateVendors = action({
  args: {
    organizationId: v.string(),
    vendors: v.array(vendorInputValidator),
  },
  returns: bulkCreateVendorsResponseValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: number;
    failed: number;
    errors: Array<{ index: number; error: string; vendor: unknown }>;
  }> => {
    return await ctx.runMutation(api.vendors.mutations.bulkCreateVendors, args);
  },
});
