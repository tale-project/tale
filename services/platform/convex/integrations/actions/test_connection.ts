'use node';

/**
 * Public action to test an integration connection
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { authComponent } from '../../auth';
import { testConnectionLogic } from '../test_connection_logic';
import { testConnectionResultValidator } from '../validators';

export const testConnection = action({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: testConnectionResultValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    return await testConnectionLogic(ctx, args);
  },
});
