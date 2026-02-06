import { mutation, internalQuery } from '../../_generated/server';
import { v } from 'convex/values';
import { generateApiKey, hashSecret } from './helpers/crypto';

export const createApiKey = mutation({
  args: {
    organizationId: v.string(),
    workflowRootId: v.id('wfDefinitions'),
    name: v.string(),
    expiresAt: v.optional(v.number()),
    createdBy: v.string(),
  },
  returns: v.object({
    keyId: v.id('wfApiKeys'),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    const rootDef = await ctx.db.get(args.workflowRootId);
    if (!rootDef) throw new Error('Workflow not found');
    if (rootDef.organizationId !== args.organizationId) {
      throw new Error('Workflow does not belong to this organization');
    }

    const key = generateApiKey();
    const keyHash = await hashSecret(key);
    const keyPrefix = key.substring(0, 12);

    const keyId = await ctx.db.insert('wfApiKeys', {
      organizationId: args.organizationId,
      workflowRootId: args.workflowRootId,
      name: args.name,
      keyHash,
      keyPrefix,
      isActive: true,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });

    return { keyId, key };
  },
});

export const revokeApiKey = mutation({
  args: { keyId: v.id('wfApiKeys') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    if (!apiKey) throw new Error('API key not found');

    await ctx.db.patch(args.keyId, { isActive: false });
    return null;
  },
});

export const deleteApiKey = mutation({
  args: { keyId: v.id('wfApiKeys') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    if (!apiKey) throw new Error('API key not found');

    await ctx.db.delete(args.keyId);
    return null;
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
