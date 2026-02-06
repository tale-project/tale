import { query, internalQuery } from '../../_generated/server';
import { v } from 'convex/values';
import type { Id, Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

/**
 * Resolve the active workflow version for a given root workflow ID.
 * Used by all trigger types to determine which version to execute.
 */
export async function getActiveWorkflowVersion(
  ctx: QueryCtx,
  workflowRootId: Id<'wfDefinitions'>,
): Promise<Doc<'wfDefinitions'> | null> {
  const rootDef = await ctx.db.get(workflowRootId);
  if (!rootDef) return null;

  const activeVersion = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', rootDef.organizationId)
        .eq('name', rootDef.name)
        .eq('status', 'active'),
    )
    .first();

  return activeVersion;
}

export const checkIdempotencyQuery = internalQuery({
  args: {
    organizationId: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_idempotencyKey', (q) =>
        q.eq('organizationId', args.organizationId).eq('idempotencyKey', args.idempotencyKey),
      )
      .first();
  },
});

export const getActiveVersion = internalQuery({
  args: { workflowRootId: v.id('wfDefinitions') },
  returns: v.union(v.id('wfDefinitions'), v.null()),
  handler: async (ctx, args) => {
    const version = await getActiveWorkflowVersion(ctx, args.workflowRootId);
    return version?._id ?? null;
  },
});

export const getSchedules = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )
      .collect();
  },
});

export const getWebhooks = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    const webhooks = await ctx.db
      .query('wfWebhooks')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )
      .collect();
    return webhooks.map((wh) => ({
      _id: wh._id,
      _creationTime: wh._creationTime,
      organizationId: wh.organizationId,
      workflowRootId: wh.workflowRootId,
      token: wh.token,
      isActive: wh.isActive,
      lastTriggeredAt: wh.lastTriggeredAt,
      createdAt: wh.createdAt,
      createdBy: wh.createdBy,
    }));
  },
});

export const getApiKeys = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query('wfApiKeys')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )
      .collect();
    return keys.map((k) => ({
      _id: k._id,
      _creationTime: k._creationTime,
      organizationId: k.organizationId,
      workflowRootId: k.workflowRootId,
      name: k.name,
      keyPrefix: k.keyPrefix,
      isActive: k.isActive,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      createdBy: k.createdBy,
    }));
  },
});

export const getTriggerLogs = query({
  args: {
    workflowRootId: v.id('wfDefinitions'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )
      .order('desc')
      .take(args.limit ?? 50);
  },
});
