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

// Look up an MCP server by its (organizationId, name) pair so the create /
// update actions can enforce per-org name uniqueness. Returns the `_id` of the
// matching server (or null) — callers compare it against the row being edited.
export const getIdByOrgAndName = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(v.id('mcpServers'), v.null()),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('mcpServers')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .first();
    return existing?._id ?? null;
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
