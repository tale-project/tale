import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { UnauthorizedError } from '../lib/rls/errors';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';

export const list = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return [];
      throw error;
    }

    const servers = [];
    for await (const server of ctx.db
      .query('mcpServers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      servers.push({
        _id: server._id,
        _creationTime: server._creationTime,
        organizationId: server.organizationId,
        name: server.name,
        displayName: server.displayName,
        description: server.description,
        transportType: server.transportType,
        url: server.url,
        command: server.command,
        args: server.args,
        authType: server.authType,
        status: server.status,
        capabilities: server.capabilities,
        discoveredTools: server.discoveredTools,
        lastConnectedAt: server.lastConnectedAt,
        lastError: server.lastError,
      });
    }
    return servers;
  },
});

export const getById = query({
  args: {
    id: v.id('mcpServers'),
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const server = await ctx.db.get(args.id);
    // Active-org coherence: deny a server carried over from another org.
    if (!server || !isActiveOrg(server.organizationId, args.organizationId)) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, server.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) return null;
      throw error;
    }

    return {
      _id: server._id,
      _creationTime: server._creationTime,
      organizationId: server.organizationId,
      name: server.name,
      displayName: server.displayName,
      description: server.description,
      transportType: server.transportType,
      url: server.url,
      command: server.command,
      args: server.args,
      authType: server.authType,
      status: server.status,
      capabilities: server.capabilities,
      discoveredTools: server.discoveredTools,
      lastConnectedAt: server.lastConnectedAt,
      lastError: server.lastError,
    };
  },
});
