import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getById = internalQuery({
  args: {
    id: v.id('mcpServers'),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const listActiveByOrg = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const servers = [];
    for await (const server of ctx.db
      .query('mcpServers')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'active'),
      )) {
      servers.push({
        _id: server._id,
        name: server.name,
        displayName: server.displayName,
        discoveredTools: server.discoveredTools,
      });
    }
    return servers;
  },
});
