import { v } from 'convex/values';
import { internalMutation, internalAction, mutation } from '../_generated/server';
import { jsonRecordValidator, jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import * as WebsitesHelpers from './helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

const websiteStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

export const provisionWebsite = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.createWebsite(ctx, args);
  },
});

export const patchWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.updateWebsite(ctx, args);
  },
});

export const bulkUpsertPages = internalMutation({
  args: {
    organizationId: v.string(),
    websiteId: v.string(),
    pages: v.array(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        wordCount: v.optional(v.number()),
        metadata: v.optional(jsonRecordValidator),
        structuredData: v.optional(jsonRecordValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.bulkUpsertPages(ctx, args);
  },
});

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

export const createWebsite = mutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
  },
  returns: v.id('websites'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    return await WebsitesHelpers.createWebsite(ctx, args);
  },
});

export const updateWebsite = mutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    status: v.optional(websiteStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const website = await ctx.db.get(args.websiteId);
    if (!website) {
      throw new Error('Website not found');
    }

    await getOrganizationMember(ctx, website.organizationId, {
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    await WebsitesHelpers.updateWebsite(ctx, args);
    return null;
  },
});

export const deleteWebsite = mutation({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const website = await ctx.db.get(args.websiteId);
    if (!website) {
      throw new Error('Website not found');
    }

    await getOrganizationMember(ctx, website.organizationId, {
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    await WebsitesHelpers.deleteWebsite(ctx, args.websiteId);
    return null;
  },
});

export const rescanWebsite = mutation({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const website = await ctx.db.get(args.websiteId);
    if (!website) {
      throw new Error('Website not found');
    }

    await getOrganizationMember(ctx, website.organizationId, {
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    await WebsitesHelpers.rescanWebsite(ctx, args.websiteId);
    return null;
  },
});
