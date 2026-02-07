'use node';

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { saveDefaultWorkflows } from './save_default_workflows';

export const initializeDefaultWorkflows = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(v.id('wfDefinitions')),
  handler: async (ctx, args) => {
    return saveDefaultWorkflows(ctx, args);
  },
});
