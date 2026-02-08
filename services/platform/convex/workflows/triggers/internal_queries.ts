import { internalQuery } from '../../_generated/server';
import { v } from 'convex/values';
import { getActiveWorkflowVersion } from './queries';

export const checkIdempotencyQuery = internalQuery({
  args: {
    organizationId: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_idempotencyKey', (q) =>
        q.eq('organizationId', args.organizationId).eq('idempotencyKey', args.idempotencyKey),
      )
      .first();
  },
});

export const getActiveVersion = internalQuery({
  args: { workflowRootId: v.id('wfDefinitions') },
  returns: v.union(v.id('wfDefinitions'), v.null()),
  handler: async (ctx, args) => {
    const version = await getActiveWorkflowVersion(ctx, args.workflowRootId);
    return version?._id ?? null;
  },
});

export const getWebhookByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfWebhooks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
  },
});

export const getApiKeyByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfApiKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .first();
  },
});
