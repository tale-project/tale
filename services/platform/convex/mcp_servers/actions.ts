'use node';

/**
 * MCP Server Actions
 *
 * Server-side actions for testing MCP connections and executing tools.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { action, internalAction } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { jsonRecordValidator } from '../lib/validators/json';
import type { McpServerConfig } from './client_factory';
import { discoverTools, executeTool } from './client_factory';

/** Map flat schema fields to the McpServerConfig expected by client_factory. */
function toClientConfig(server: Doc<'mcpServers'>): McpServerConfig {
  return {
    transportType: server.transportType === 'stdio' ? 'stdio' : 'http',
    httpConfig: server.url ? { url: server.url } : undefined,
    stdioConfig: server.command
      ? { command: server.command, args: server.args, env: server.env }
      : undefined,
    authType: server.authType === 'api_key' ? 'bearer' : server.authType,
    bearerToken: server.apiKeyEncrypted
      ? { tokenEncrypted: server.apiKeyEncrypted }
      : undefined,
    oauth2Config: server.oauth2Config,
    oauth2Tokens: server.oauth2Tokens,
  };
}

export const testConnection = action({
  args: {
    id: v.id('mcpServers'),
  },
  handler: async (ctx, args) => {
    const server = await ctx.runQuery(
      internal.mcp_servers.internal_queries.getById,
      { id: args.id },
    );
    if (!server) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    // Verify the caller is a live member of the org that OWNS this server and
    // holds the developerSettings capability before running discovery against
    // the server with its stored credentials. Deriving the org from the server
    // doc (rather than a client-supplied arg) makes the ownership match
    // implicit — a member of another org cannot reach this server.
    await requireOrgAdminOrDeveloper(ctx, server.organizationId);

    // Set status to discovering
    await ctx.runMutation(
      internal.mcp_servers.mutations.updateDiscoveredTools,
      {
        id: args.id,
        discoveredTools: server.discoveredTools ?? [],
        status: 'discovering',
        lastTestedAt: Date.now(),
      },
    );

    try {
      const { tools, tokenUpdate } = await discoverTools(
        toClientConfig(server),
      );

      // Persist refreshed tokens if updated
      if (tokenUpdate) {
        await ctx.runMutation(
          internal.mcp_servers.mutations.updateOauth2Tokens,
          {
            id: args.id,
            accessTokenEncrypted: tokenUpdate.accessTokenEncrypted,
            refreshTokenEncrypted: tokenUpdate.refreshTokenEncrypted,
            tokenExpiry: tokenUpdate.tokenExpiry,
          },
        );
      }

      await ctx.runMutation(
        internal.mcp_servers.mutations.updateDiscoveredTools,
        {
          id: args.id,
          discoveredTools: tools,
          status: 'active',
          lastTestedAt: Date.now(),
        },
      );

      return {
        success: true,
        toolCount: tools.length,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Connection failed';

      await ctx.runMutation(
        internal.mcp_servers.mutations.updateDiscoveredTools,
        {
          id: args.id,
          discoveredTools: server.discoveredTools ?? [],
          status: 'error',
          lastTestedAt: Date.now(),
          lastErrorMessage: message,
        },
      );

      return { success: false, error: message };
    }
  },
});

/**
 * Execute a named tool against an MCP server with its stored (decrypted)
 * credentials.
 *
 * Backend-orchestration only — exposed as an `internalAction`, NOT a public
 * `api.*` action. The decrypted bearer token / OAuth secret and the
 * server-controlled `server.url` it reaches make a public surface a
 * cross-tenant credential-use + SSRF primitive: any authenticated user could
 * drive another tenant's server. The only callers are trusted backend paths
 * that have already resolved the server to the caller's org —
 * `agent_tools/mcp/create_bound_mcp_tool.ts` (the bound agent tool) and
 * `mcp_servers/execute_approved.ts` (post-approval replay) — both via
 * `ctx.runAction(internal.mcp_servers.actions.executeMcpTool, …)`.
 */
export const executeMcpTool = internalAction({
  args: {
    serverId: v.id('mcpServers'),
    toolName: v.string(),
    toolArgs: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const server = await ctx.runQuery(
      internal.mcp_servers.internal_queries.getById,
      { id: args.serverId },
    );
    if (!server) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    if (server.status !== 'active') {
      throw new ConvexError({ code: 'SERVER_NOT_ACTIVE', name: server.name });
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores JSON args as unknown; shape is guaranteed by caller
    const toolArgs = (args.toolArgs ?? {}) as Record<string, unknown>;

    const { result, tokenUpdate } = await executeTool(
      toClientConfig(server),
      args.toolName,
      toolArgs,
    );

    // Persist refreshed tokens if updated
    if (tokenUpdate) {
      await ctx.runMutation(internal.mcp_servers.mutations.updateOauth2Tokens, {
        id: args.serverId,
        accessTokenEncrypted: tokenUpdate.accessTokenEncrypted,
        refreshTokenEncrypted: tokenUpdate.refreshTokenEncrypted,
        tokenExpiry: tokenUpdate.tokenExpiry,
      });
    }

    if (result.isError) {
      const errorText = result.content
        .map((c) => c.text ?? '')
        .filter(Boolean)
        .join('\n');
      throw new Error(`MCP tool error: ${errorText || 'Unknown error'}`);
    }

    // Extract text content from result
    const textContent = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    return {
      success: true,
      content: textContent || JSON.stringify(result.content),
      rawContent: result.content,
    };
  },
});
