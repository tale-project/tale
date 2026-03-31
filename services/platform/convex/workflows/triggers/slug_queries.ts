import { v } from 'convex/values';

import type { Doc } from '../../_generated/dataModel';

import { query } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';

export const getSchedulesBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfSchedules'>[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfSchedules'>[] = [];
    for await (const schedule of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (schedule.organizationId === args.organizationId) {
        results.push(schedule);
      }
    }
    return results;
  },
});

export const getWebhooksBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfWebhooks'>[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfWebhooks'>[] = [];
    for await (const webhook of ctx.db
      .query('wfWebhooks')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (webhook.organizationId === args.organizationId) {
        results.push(webhook);
      }
    }
    return results;
  },
});

export const getEventSubscriptionsBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfEventSubscriptions'>[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfEventSubscriptions'>[] = [];
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sub.organizationId === args.organizationId) {
        results.push(sub);
      }
    }
    return results;
  },
});

export const getTriggerLogsBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfTriggerLogs'>[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfTriggerLogs'>[] = [];
    for await (const log of ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )
      .order('desc')) {
      if (log.organizationId === args.organizationId) {
        results.push(log);
      }
    }
    return results;
  },
});
