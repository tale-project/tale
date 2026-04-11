'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { encryptString } from '../lib/crypto/encrypt_string';
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

const oauth2InputValidator = v.object({
  tokenUrl: v.string(),
  authorizationUrl: v.optional(v.string()),
  clientId: v.string(),
  clientSecret: v.string(),
  scopes: v.optional(v.array(v.string())),
  grantType: v.union(
    v.literal('client_credentials'),
    v.literal('authorization_code'),
  ),
});

interface EncryptedOAuth2Config {
  tokenUrl: string;
  authorizationUrl?: string;
  clientId: string;
  clientSecretEncrypted: string;
  scopes: string[];
  grantType: 'client_credentials' | 'authorization_code';
}

async function encryptOAuth2Config(raw: {
  tokenUrl: string;
  authorizationUrl?: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  grantType: 'client_credentials' | 'authorization_code';
}): Promise<EncryptedOAuth2Config> {
  const clientSecretEncrypted = await encryptString(raw.clientSecret);
  return {
    tokenUrl: raw.tokenUrl,
    authorizationUrl: raw.authorizationUrl,
    clientId: raw.clientId,
    clientSecretEncrypted,
    scopes: raw.scopes ?? [],
    grantType: raw.grantType,
  };
}

export const create = action({
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
    apiKey: v.optional(v.string()),
    oauth2Config: v.optional(oauth2InputValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    let apiKeyEncrypted: string | undefined;
    if (args.authType === 'api_key' && args.apiKey) {
      apiKeyEncrypted = await encryptString(args.apiKey);
    }

    let oauth2Config: EncryptedOAuth2Config | undefined;
    if (args.authType === 'oauth2' && args.oauth2Config) {
      oauth2Config = await encryptOAuth2Config(args.oauth2Config);
    }

    const id: string = await ctx.runMutation(
      internal.mcp_servers.mutations.insert,
      {
        organizationId: args.organizationId,
        name: args.name,
        displayName: args.displayName,
        description: args.description,
        transportType: args.transportType,
        url: args.url,
        command: args.command,
        args: args.args,
        env: args.env,
        authType: args.authType,
        apiKeyEncrypted,
        oauth2Config,
        status: 'inactive',
      },
    );

    return id;
  },
});

export const update = action({
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
    apiKey: v.optional(v.string()),
    oauth2Config: v.optional(oauth2InputValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const { id, apiKey, oauth2Config: rawOAuth2, ...rest } = args;

    let apiKeyEncrypted: string | undefined;
    if (apiKey) {
      apiKeyEncrypted = await encryptString(apiKey);
    }

    let oauth2Config: EncryptedOAuth2Config | undefined;
    if (rawOAuth2) {
      oauth2Config = await encryptOAuth2Config(rawOAuth2);
    }

    await ctx.runMutation(internal.mcp_servers.mutations.update, {
      id,
      ...rest,
      ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}),
      ...(oauth2Config !== undefined ? { oauth2Config } : {}),
    });

    return null;
  },
});

export const remove = action({
  args: {
    id: v.id('mcpServers'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ctx.runMutation(internal.mcp_servers.mutations.remove, {
      id: args.id,
    });

    return null;
  },
});

export const updateStatus = action({
  args: {
    id: v.id('mcpServers'),
    status: v.union(v.literal('active'), v.literal('inactive')),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ctx.runMutation(internal.mcp_servers.mutations.setStatus, {
      id: args.id,
      status: args.status,
    });

    return null;
  },
});
