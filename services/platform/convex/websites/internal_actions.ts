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

export const deregisterWebsiteFromCrawler = internalAction({
  args: {
    domain: v.string(),
  },
  handler: async (_ctx, args) => {
    const crawlerUrl = process.env.CRAWLER_URL || 'http://localhost:8002';
    try {
      await fetch(
        `${crawlerUrl}/api/v1/websites?url=${encodeURIComponent(args.domain)}`,
        { method: 'DELETE' },
      );
    } catch (e) {
      console.warn('Failed to deregister website from crawler:', e);
    }
  },
});
