import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import * as WebsitesHelpers from './helpers';

export const getWebsite = internalQuery({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getWebsite(ctx, args.websiteId);
  },
});

export const getWebsiteByDomain = internalQuery({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getWebsiteByDomain(ctx, args);
  },
});

export const getWebsitePageByUrl = internalQuery({
  args: {
    organizationId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getPageByUrl(ctx, args);
  },
});

export const findPendingPages = internalQuery({
  args: {
    websiteId: v.id('websites'),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.findPendingPages(ctx, args);
  },
});
