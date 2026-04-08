import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { jsonRecordValidator } from '../lib/validators/json';

export const updateDiscoveredTools = internalMutation({
  args: {
    id: v.id('mcpServers'),
    discoveredTools: v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        inputSchema: v.optional(jsonRecordValidator),
        requiresApproval: v.optional(v.boolean()),
      }),
    ),
    status: v.union(
      v.literal('active'),
      v.literal('inactive'),
      v.literal('error'),
      v.literal('discovering'),
    ),
    lastTestedAt: v.optional(v.number()),
    lastErrorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, {
      discoveredTools: patch.discoveredTools,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- status union is a superset during discovery
      status: patch.status as 'active' | 'inactive' | 'error',
      lastConnectedAt: patch.lastTestedAt,
      lastError: patch.lastErrorMessage,
    });
    return null;
  },
});

export const updateOauth2Tokens = internalMutation({
  args: {
    id: v.id('mcpServers'),
    accessTokenEncrypted: v.string(),
    refreshTokenEncrypted: v.optional(v.string()),
    tokenExpiry: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      oauth2Tokens: {
        accessTokenEncrypted: args.accessTokenEncrypted,
        refreshTokenEncrypted: args.refreshTokenEncrypted,
        tokenExpiry: args.tokenExpiry,
      },
    });
    return null;
  },
});
