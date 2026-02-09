import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import * as WebsitesHelpers from './helpers';

export const provisionWebsiteScanWorkflow = internalAction({
  args: {
    organizationId: v.string(),
    websiteId: v.id('websites'),
    domain: v.string(),
    scanInterval: v.string(),
    autoTriggerInitialScan: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.provisionWebsiteScanWorkflow(ctx, args);
  },
});
