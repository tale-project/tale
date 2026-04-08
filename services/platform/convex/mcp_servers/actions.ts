'use node';

/**
 * MCP Server Actions
 *
 * Server-side actions for testing MCP connections and executing tools.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { jsonRecordValidator } from '../lib/validators/json';
import { discoverTools, executeTool } from './client_factory';

export const testConnection = action({
  args: {
    id: v.id('mcpServers'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const server = await ctx.runQuery(
      internal.mcp_servers.internal_queries.getById,
      { id: args.id },
    );
    if (!server) {
      throw new Error('MCP server not found');
    }

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
      const { tools, tokenUpdate } = await discoverTools({
        transportType: server.transportType,
        httpConfig: server.httpConfig,
        stdioConfig: server.stdioConfig,
        authType: server.authType,
        bearerToken: server.bearerToken,
        oauth2Config: server.oauth2Config,
        oauth2Tokens: server.oauth2Tokens,
      });

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

export const executeMcpTool = action({
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
      throw new Error('MCP server not found');
    }

    if (server.status !== 'active') {
      throw new Error(`MCP server "${server.name}" is not active`);
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores JSON args as unknown; shape is guaranteed by caller
    const toolArgs = (args.toolArgs ?? {}) as Record<string, unknown>;

    const { result, tokenUpdate } = await executeTool(
      {
        transportType: server.transportType,
        httpConfig: server.httpConfig,
        stdioConfig: server.stdioConfig,
        authType: server.authType,
        bearerToken: server.bearerToken,
        oauth2Config: server.oauth2Config,
        oauth2Tokens: server.oauth2Tokens,
      },
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
