'use node';

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { saveDefaultWorkflows } from './save_default_workflows';

export const initializeDefaultWorkflows = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return saveDefaultWorkflows(ctx, args);
  },
});
