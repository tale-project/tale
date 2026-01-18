'use node';

/**
 * Public action to test an integration connection
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { testConnectionLogic } from '../test_connection_logic';
import { testConnectionResultValidator } from '../validators';
import type { TestConnectionResult } from '../types';

export const test = action({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: testConnectionResultValidator,
  handler: async (ctx, args): Promise<TestConnectionResult> => {
    return await testConnectionLogic(ctx, args);
  },
});
