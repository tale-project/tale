'use node';

import { ConvexError, v } from 'convex/values';

import { isHttpUrl } from '../../lib/utils/url';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { encryptString } from '../lib/crypto/encrypt_string';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { jsonRecordValidator } from '../lib/validators/json';
import { MCP_SERVER_NAME_MAX_LENGTH, validateMcpServerName } from './constants';

// Validate the slug-style `name` server-side (the client form mirrors the same
// rule). Throws a ConvexError so the message can surface in the UI toast.
function assertValidMcpServerName(name: string): void {
  const code = validateMcpServerName(name);
  if (code === null) return;
  const message =
    code === 'required'
      ? 'Name is required.'
      : code === 'too_long'
        ? `Name must be at most ${MCP_SERVER_NAME_MAX_LENGTH} characters.`
        : 'Name must be lowercase alphanumeric with hyphens (e.g. my-mcp-server).';
  throw new ConvexError({ code: 'invalid', message });
}

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

/** Reject malformed or non-http(s) URLs at the backend boundary. */
function assertHttpUrl(value: string | undefined, label: string): void {
  if (value !== undefined && !isHttpUrl(value)) {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL`);
  }
}

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const name = args.name.trim();
    assertValidMcpServerName(name);
    const duplicateId = await ctx.runQuery(
      internal.mcp_servers.internal_queries.getIdByOrgAndName,
      { organizationId: args.organizationId, name },
    );
    if (duplicateId !== null) {
      throw new ConvexError({
        code: 'conflict',
        message: `An MCP server named "${name}" already exists in this organization.`,
      });
    }

    if (
      args.transportType === 'sse' ||
      args.transportType === 'streamable_http'
    ) {
      assertHttpUrl(args.url ?? '', 'URL');
    }
    if (args.oauth2Config) {
      assertHttpUrl(args.oauth2Config.tokenUrl, 'Token URL');
      assertHttpUrl(args.oauth2Config.authorizationUrl, 'Authorization URL');
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
        name,
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    if (args.url) {
      assertHttpUrl(args.url, 'URL');
    }
    if (args.oauth2Config) {
      assertHttpUrl(args.oauth2Config.tokenUrl, 'Token URL');
      assertHttpUrl(args.oauth2Config.authorizationUrl, 'Authorization URL');
    }

    const { id, apiKey, oauth2Config: rawOAuth2, ...rest } = args;

    // Validate the slug + enforce per-org uniqueness when the name is being
    // changed. The existing row supplies the org scope (and is excluded so a
    // no-op rename to its own name doesn't trip the conflict check).
    if (rest.name !== undefined) {
      const name = rest.name.trim();
      assertValidMcpServerName(name);
      rest.name = name;
      const existing = await ctx.runQuery(
        internal.mcp_servers.internal_queries.getById,
        { id },
      );
      if (!existing) {
        throw new ConvexError({
          code: 'not_found',
          message: 'MCP server not found.',
        });
      }
      const duplicateId = await ctx.runQuery(
        internal.mcp_servers.internal_queries.getIdByOrgAndName,
        { organizationId: existing.organizationId, name },
      );
      if (duplicateId !== null && duplicateId !== id) {
        throw new ConvexError({
          code: 'conflict',
          message: `An MCP server named "${name}" already exists in this organization.`,
        });
      }
    }

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    await ctx.runMutation(internal.mcp_servers.mutations.setStatus, {
      id: args.id,
      status: args.status,
    });

    return null;
  },
});
