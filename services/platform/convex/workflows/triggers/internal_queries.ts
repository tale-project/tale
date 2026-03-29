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
