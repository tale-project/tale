import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { jsonRecordValidator } from '../lib/validators/json';

const transportTypeValidator = v.union(
  v.literal('stdio'),
  v.literal('sse'),
  v.literal('streamable_http'),
);

const authTypeValidator = v.union(
  v.literal('none'),
  v.literal('api_key'),
  v.literal('oauth2'),
);

const oauth2ConfigValidator = v.object({
  tokenUrl: v.string(),
  authorizationUrl: v.optional(v.string()),
  clientId: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  grantType: v.union(
    v.literal('client_credentials'),
    v.literal('authorization_code'),
  ),
});

const statusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

export const insert = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    displayName: v.string(),
    description: v.optional(v.string()),
    transportType: transportTypeValidator,
    url: v.optional(v.string()),
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    env: v.optional(jsonRecordValidator),
    authType: authTypeValidator,
    apiKeyEncrypted: v.optional(v.string()),
    oauth2Config: v.optional(oauth2ConfigValidator),
    status: statusValidator,
  },
  returns: v.id('mcpServers'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('mcpServers', args);
  },
});

export const update = internalMutation({
  args: {
    id: v.id('mcpServers'),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
    description: v.optional(v.string()),
    transportType: v.optional(transportTypeValidator),
    url: v.optional(v.string()),
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    env: v.optional(jsonRecordValidator),
    authType: v.optional(authTypeValidator),
    apiKeyEncrypted: v.optional(v.string()),
    oauth2Config: v.optional(oauth2ConfigValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    const server = await ctx.db.get(id);
    if (!server) throw new Error('MCP server not found');
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = internalMutation({
  args: {
    id: v.id('mcpServers'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.id);
    if (!server) throw new Error('MCP server not found');
    await ctx.db.delete(args.id);
    return null;
  },
});

export const setStatus = internalMutation({
  args: {
    id: v.id('mcpServers'),
    status: v.union(v.literal('active'), v.literal('inactive')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.id);
    if (!server) throw new Error('MCP server not found');
    await ctx.db.patch(args.id, { status: args.status });
    return null;
  },
});

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
