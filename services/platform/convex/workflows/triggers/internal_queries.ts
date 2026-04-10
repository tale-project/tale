import { v } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import { internalQuery } from '../../_generated/server';

export const checkIdempotencyQuery = internalQuery({
  args: {
    organizationId: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfTriggerLogs'> | null> => {
    return await ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_idempotencyKey', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('idempotencyKey', args.idempotencyKey),
      )
      .first();
  },
});

export const getActiveVersion = internalQuery({
  args: { workflowRootId: v.id('wfDefinitions') },
  returns: v.union(v.id('wfDefinitions'), v.null()),
  handler: async (ctx, args): Promise<Id<'wfDefinitions'> | null> => {
    for await (const version of ctx.db
      .query('wfDefinitions')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', args.workflowRootId).eq('status', 'active'),
      )) {
      return version._id;
    }
    const root = await ctx.db.get(args.workflowRootId);
    if (root?.status === 'active') return root._id;
    return null;
  },
});

export const getWebhookByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Doc<'wfWebhooks'> | null> => {
    return await ctx.db
      .query('wfWebhooks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
  },
});

export const getApiKeyByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args): Promise<Doc<'wfApiKeys'> | null> => {
    return await ctx.db
      .query('wfApiKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .first();
  },
});

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

export const getSchedulesBySlugInternal = internalQuery({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfSchedules'>[]> => {
    const results: Doc<'wfSchedules'>[] = [];
    for await (const schedule of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (schedule.organizationId === args.organizationId) {
        results.push(schedule);
      }
    }
    return results;
  },
});

export const getWebhooksBySlugInternal = internalQuery({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfWebhooks'>[]> => {
    const results: Doc<'wfWebhooks'>[] = [];
    for await (const webhook of ctx.db
      .query('wfWebhooks')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (webhook.organizationId === args.organizationId) {
        results.push(webhook);
      }
    }
    return results;
  },
});

export const getTriggerLogsBySlugInternal = internalQuery({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfTriggerLogs'>[]> => {
    const results: Doc<'wfTriggerLogs'>[] = [];
    for await (const log of ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )
      .order('desc')) {
      if (log.organizationId === args.organizationId) {
        results.push(log);
      }
    }
    return results;
  },
});
