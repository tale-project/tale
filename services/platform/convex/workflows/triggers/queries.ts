import { v } from 'convex/values';

import type { Id, Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

import { query } from '../../_generated/server';

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

export const getSchedules = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    const results: Doc<'wfSchedules'>[] = [];
    for await (const schedule of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )) {
      results.push(schedule);
    }
    return results;
  },
});

export const getWebhooks = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    const results: Array<{
      _id: Id<'wfWebhooks'>;
      _creationTime: number;
      organizationId: string;
      workflowRootId: Id<'wfDefinitions'>;
      token: string;
      isActive: boolean;
      lastTriggeredAt?: number;
      createdAt: number;
      createdBy?: string;
    }> = [];
    for await (const wh of ctx.db
      .query('wfWebhooks')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )) {
      results.push({
        _id: wh._id,
        _creationTime: wh._creationTime,
        organizationId: wh.organizationId,
        workflowRootId: wh.workflowRootId,
        token: wh.token,
        isActive: wh.isActive,
        lastTriggeredAt: wh.lastTriggeredAt,
        createdAt: wh.createdAt,
        createdBy: wh.createdBy,
      });
    }
    return results;
  },
});

export const getApiKeys = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    const results: Array<{
      _id: Id<'wfApiKeys'>;
      _creationTime: number;
      organizationId: string;
      workflowRootId: Id<'wfDefinitions'>;
      name: string;
      keyPrefix: string;
      isActive: boolean;
      expiresAt?: number;
      createdAt: number;
      createdBy?: string;
    }> = [];
    for await (const k of ctx.db
      .query('wfApiKeys')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )) {
      results.push({
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
      });
    }
    return results;
  },
});

export const getEventSubscriptions = query({
  args: { workflowRootId: v.id('wfDefinitions') },
  handler: async (ctx, args) => {
    const results: Doc<'wfEventSubscriptions'>[] = [];
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )) {
      results.push(sub);
    }
    return results;
  },
});

export const getTriggerLogs = query({
  args: {
    workflowRootId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    const results: Doc<'wfTriggerLogs'>[] = [];
    for await (const log of ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_workflowRoot', (q) =>
        q.eq('workflowRootId', args.workflowRootId),
      )
      .order('desc')) {
      results.push(log);
    }
    return results;
  },
});
